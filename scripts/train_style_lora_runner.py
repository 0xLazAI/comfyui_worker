#!/usr/bin/env python3
"""GPU-side runner for train_style_lora worker tasks.

The API worker owns task lifecycle. This runner owns the GPU-machine details:
download the flat S3 dataset, validate image/txt pairs, launch training, expose
status, and return local LoRA paths.

Commands:
  train_style_lora submit < request.json
  train_style_lora status --job-id train_xxx
  train_style_lora finalize --job-id train_xxx
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


RUNS_DIR = Path(os.environ.get("LORA_TRAINER_RUNS_DIR", "/home/ubuntu/sd/lora_runs"))
GPU_ID = os.environ.get("LORA_TRAINER_GPU_ID", "5")
SD_ROOT = Path(os.environ.get("SD_ROOT", "/home/ubuntu/sd"))
MUSUBI_ROOT = Path(os.environ.get("MUSUBI_ROOT", str(SD_ROOT / "musubi-tuner")))
COMFY_PY = os.environ.get("COMFY_PY", str(SD_ROOT / "ComfyUI/venv/bin/python"))
KLEIN_PY = os.environ.get("KLEIN_PY", str(SD_ROOT / "flux2_klein/venv/bin/python"))
ACCELERATE_CONFIG = os.environ.get("ACCELERATE_CONFIG", str(SD_ROOT / "acc_single.yaml"))

FLUX2_DEV_DIT = os.environ.get(
    "FLUX2_DEV_DIT",
    "/mnt_zkm/film/comfyui_models/ai_toolkit_flux2/flux2-dev-bf16.safetensors",
)
FLUX2_DEV_VAE = os.environ.get(
    "FLUX2_DEV_VAE",
    "/mnt_zkm/film/comfyui_models/vae/flux2_ae_bfl.safetensors",
)
FLUX2_DEV_TEXT_ENCODER = os.environ.get(
    "FLUX2_DEV_TEXT_ENCODER",
    "/mnt_zkm/film/comfyui_models/text_encoders/mistral_3_small_flux2_bf16_musubi.safetensors",
)

KLEIN9B_DIT = os.environ.get(
    "KLEIN9B_DIT",
    "/home/ubuntu/sd/flux2_klein/models/flux-2-klein-base-9b.safetensors",
)
KLEIN9B_VAE = os.environ.get(
    "KLEIN9B_VAE",
    "/mnt_zkm/film/comfyui_models/vae/flux2_ae_bfl.safetensors",
)
KLEIN9B_TEXT_ENCODER = os.environ.get(
    "KLEIN9B_TEXT_ENCODER",
    "/home/ubuntu/sd/flux2_klein/models/text_encoder/model-00001-of-00004.safetensors",
)

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
TERMINAL_STATUSES = {"done", "failed", "rejected", "cancelled", "canceled"}
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def main() -> int:
    parser = argparse.ArgumentParser(description="LoRA style training runner")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("submit")
    status_parser = sub.add_parser("status")
    status_parser.add_argument("--job-id", required=True)
    finalize_parser = sub.add_parser("finalize")
    finalize_parser.add_argument("--job-id", required=True)
    run_parser = sub.add_parser("_run")
    run_parser.add_argument("--job-id", required=True)

    args = parser.parse_args()
    try:
        if args.command == "submit":
            print_json(submit(json.load(sys.stdin)))
        elif args.command == "status":
            print_json(status(args.job_id))
        elif args.command == "finalize":
            print_json(finalize(args.job_id))
        elif args.command == "_run":
            run_job(args.job_id)
        return 0
    except Exception as error:
        print_json({
            "status": "failed",
            "error": str(error),
        })
        return 1


def submit(request: dict[str, Any]) -> dict[str, Any]:
    validate_request(request)
    job_id = f"train_{uuid.uuid4().hex[:12]}"
    run_dir = RUNS_DIR / job_id
    output_dir = run_dir / "output"
    run_dir.mkdir(parents=True, exist_ok=False)
    output_dir.mkdir(parents=True, exist_ok=True)

    write_json(run_dir / "request.json", request)
    write_status(run_dir, {
        "status": "submitted",
        "phase": "submitted",
        "message": "trainer job submitted",
        "progress": 0,
    })

    log_file = open(run_dir / "train.log", "ab", buffering=0)
    child = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "_run", "--job-id", job_id],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    write_json(run_dir / "pid.json", {"pid": child.pid, "createdAt": utc_now()})
    current = read_status(run_dir)
    current.update({
        "pid": child.pid,
        "jobId": job_id,
        "runDir": str(run_dir),
        "statusPath": str(run_dir / "status.json"),
        "logPath": str(run_dir / "train.log"),
        "outputDir": str(output_dir),
    })
    write_status(run_dir, current)

    return public_status(job_id, run_dir, current)


def status(job_id: str) -> dict[str, Any]:
    run_dir = job_run_dir(job_id)
    state = read_status(run_dir)
    normalized = str(state.get("status") or "").strip().lower()
    if normalized and normalized not in TERMINAL_STATUSES and not pid_alive(run_dir):
        state.update({
            "status": "failed",
            "phase": state.get("phase") or "unknown",
            "error": "training process exited without terminal status",
            "message": "training process exited without terminal status",
            "finishedAt": utc_now(),
            "lastLogLines": tail_lines(run_dir / "train.log"),
        })
        write_status(run_dir, state)
    return public_status(job_id, run_dir, state)


def finalize(job_id: str) -> dict[str, Any]:
    run_dir = job_run_dir(job_id)
    state = status(job_id)
    if str(state.get("status") or "").lower() not in {"done", "succeeded", "success", "completed"}:
        return state

    request = read_json(run_dir / "request.json")
    lora = request["lora"]
    publish = request.get("publish") or {}
    filename = publish.get("filename") or f"{lora['name']}.safetensors"
    output_dir = run_dir / "output"
    local_path = output_dir / filename
    if not local_path.exists():
        candidates = sorted(output_dir.glob("*.safetensors"), key=lambda p: p.stat().st_mtime, reverse=True)
        if candidates:
            local_path = candidates[0]
        else:
            raise RuntimeError(f"trained LoRA not found in {output_dir}")

    metadata_path = output_dir / f"{local_path.stem}.metadata.json"
    if not metadata_path.exists():
        write_metadata(request, run_dir, local_path, metadata_path, state)

    return {
        "status": "succeeded",
        "lora": {
            "publishMode": "local",
            "usableScope": "training_gpu_only",
            "name": lora["name"],
            "kind": lora.get("kind", "style"),
            "baseProfile": request["baseProfile"],
            "trigger": lora["trigger"],
            "localPath": str(local_path),
            "metadataPath": str(metadata_path),
        },
    }


def run_job(job_id: str) -> None:
    run_dir = job_run_dir(job_id)
    request = read_json(run_dir / "request.json")
    try:
        log(run_dir, f"starting job {job_id}")
        dataset_dir = run_dir / "dataset"
        sync_and_validate_dataset(request["dataset"]["uri"], dataset_dir, run_dir)
        write_dataset_toml(request, run_dir, dataset_dir)

        preset = str((request.get("train") or {}).get("preset") or "").strip().lower()
        if preset == "smoke":
            run_smoke_training(request, run_dir)
        else:
            run_real_training(request, run_dir)

        output_file = expected_output_file(request, run_dir)
        metadata_path = output_file.with_suffix(".metadata.json")
        write_metadata(request, run_dir, output_file, metadata_path, read_status(run_dir))
        update_status(run_dir, {
            "status": "done",
            "phase": "done",
            "progress": 1,
            "message": "training done",
            "finishedAt": utc_now(),
            "localPath": str(output_file),
            "metadataPath": str(metadata_path),
        })
        log(run_dir, "DONE")
    except Exception as error:
        update_status(run_dir, {
            "status": "failed",
            "error": str(error),
            "message": str(error),
            "finishedAt": utc_now(),
            "lastLogLines": tail_lines(run_dir / "train.log"),
        })
        log(run_dir, f"FAILED: {error}")
        raise


def sync_and_validate_dataset(uri: str, dataset_dir: Path, run_dir: Path) -> None:
    update_status(run_dir, {
        "status": "running",
        "phase": "syncing_dataset",
        "message": "syncing dataset from s3",
        "progress": 0.05,
    })
    dataset_dir.mkdir(parents=True, exist_ok=True)

    bucket, prefix = parse_s3_uri(uri)
    objects = list_s3_objects(bucket, prefix)
    files = []
    subdir_entries = []
    for key, size in objects:
        rel = key[len(prefix):]
        if not rel or rel.endswith("/"):
            continue
        if "/" in rel:
            subdir_entries.append(rel)
            continue
        suffix = Path(rel).suffix.lower()
        if suffix in IMAGE_EXTENSIONS or suffix == ".txt":
            files.append((key, rel, size))

    if subdir_entries:
        raise ValueError(f"dataset must be flat; found subdir entries: {subdir_entries[:10]}")
    if not files:
        raise ValueError(f"dataset contains no supported files: {uri}")

    for key, rel, _size in files:
        run(["aws", "s3", "cp", f"s3://{bucket}/{key}", str(dataset_dir / rel)], run_dir=run_dir)

    update_status(run_dir, {
        "phase": "validating_dataset",
        "message": "validating image/txt pairs",
        "progress": 0.10,
    })
    validate_local_dataset(dataset_dir)


def validate_local_dataset(dataset_dir: Path) -> None:
    files = [p for p in dataset_dir.iterdir() if p.is_file()]
    images = [p for p in files if p.suffix.lower() in IMAGE_EXTENSIONS]
    if not images:
        raise ValueError("dataset has no image files")

    errors: list[str] = []
    for image in sorted(images):
        caption = image.with_suffix(".txt")
        if not caption.exists():
            errors.append(f"missing caption for {image.name}")
            continue
        if not caption.read_text(encoding="utf-8").strip():
            errors.append(f"empty caption: {caption.name}")
        if image.stat().st_size <= 0:
            errors.append(f"empty image file: {image.name}")
        if not has_valid_image_header(image):
            errors.append(f"unsupported or corrupt image header: {image.name}")

    orphan_captions = [
        p.name for p in files
        if p.suffix.lower() == ".txt"
        and not any((dataset_dir / f"{p.stem}{ext}").exists() for ext in IMAGE_EXTENSIONS)
    ]
    if orphan_captions:
        errors.append(f"caption without image: {orphan_captions[:10]}")

    if errors:
        raise ValueError("; ".join(errors[:20]))


def has_valid_image_header(path: Path) -> bool:
    data = path.read_bytes()[:16]
    suffix = path.suffix.lower()
    if suffix == ".png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return data.startswith(b"\xff\xd8\xff")
    if suffix == ".webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


def write_dataset_toml(request: dict[str, Any], run_dir: Path, dataset_dir: Path) -> None:
    cache_dir = run_dir / "cache"
    text = "\n".join([
        "[general]",
        "resolution = [1024, 1024]",
        'caption_extension = ".txt"',
        "batch_size = 1",
        "enable_bucket = true",
        "bucket_no_upscale = false",
        "",
        "[[datasets]]",
        f'image_directory = "{dataset_dir}"',
        f'cache_directory = "{cache_dir}"',
        "num_repeats = 1",
        "",
    ])
    (run_dir / "dataset.toml").write_text(text, encoding="utf-8")


def run_smoke_training(request: dict[str, Any], run_dir: Path) -> None:
    update_status(run_dir, {
        "status": "running",
        "phase": "training",
        "message": "smoke training",
        "currentStep": 1,
        "totalSteps": 1,
        "progress": 0.8,
    })
    time.sleep(1)
    output_file = expected_output_file(request, run_dir)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    write_minimal_safetensors(output_file, {
        "smoke": "true",
        "baseProfile": str(request.get("baseProfile") or ""),
        "trigger": str((request.get("lora") or {}).get("trigger") or ""),
    })


def run_real_training(request: dict[str, Any], run_dir: Path) -> None:
    base_profile = request["baseProfile"]
    if base_profile == "flux2_dev_bf16":
        run_flux2_dev_training(request, run_dir)
    elif base_profile == "flux2_klein9b":
        run_klein9b_training(request, run_dir)
    else:
        raise ValueError(f"unsupported baseProfile: {base_profile}")


def run_flux2_dev_training(request: dict[str, Any], run_dir: Path) -> None:
    train = request.get("train") or {}
    dataset_toml = str(run_dir / "dataset.toml")
    output_dir = str(run_dir / "output")
    output_name = expected_output_file(request, run_dir).stem
    env = os.environ.copy()
    env["PYTHONPATH"] = str(MUSUBI_ROOT / "src")
    env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

    update_status(run_dir, {"phase": "cache_latents", "message": "caching latents", "progress": 0.15})
    run([COMFY_PY, "-m", "musubi_tuner.flux_2_cache_latents",
         "--dataset_config", dataset_toml,
         "--vae", FLUX2_DEV_VAE], cwd=MUSUBI_ROOT, env=env, run_dir=run_dir)

    update_status(run_dir, {"phase": "cache_text_encoder", "message": "caching text encoder outputs", "progress": 0.30})
    cpu_env = env.copy()
    cpu_env["CUDA_VISIBLE_DEVICES"] = ""
    run([COMFY_PY, "-m", "musubi_tuner.flux_2_cache_text_encoder_outputs",
         "--dataset_config", dataset_toml,
         "--text_encoder", FLUX2_DEV_TEXT_ENCODER,
         "--model_version", "dev",
         "--device", "cpu"], cwd=MUSUBI_ROOT, env=cpu_env, run_dir=run_dir)

    update_status(run_dir, {
        "phase": "training",
        "message": "training",
        "progress": 0.45,
        "currentStep": 0,
        "totalSteps": int(train["steps"]),
    })
    gpu_env = env.copy()
    gpu_env["CUDA_VISIBLE_DEVICES"] = str(GPU_ID)
    cmd = [
        COMFY_PY, "-m", "musubi_tuner.flux_2_train_network",
        "--dataset_config", dataset_toml,
        "--dit", FLUX2_DEV_DIT,
        "--vae", FLUX2_DEV_VAE,
        "--text_encoder", FLUX2_DEV_TEXT_ENCODER,
        "--model_version", "dev",
        "--network_module", "musubi_tuner.networks.lora_flux_2",
        "--network_dim", str(train["rank"]),
        "--network_alpha", str(train["alpha"]),
        "--learning_rate", str(train["lr"]),
        "--max_train_steps", str(train["steps"]),
        "--optimizer_type", "adamw8bit",
        "--mixed_precision", "bf16",
        "--fp8_base",
        "--fp8_scaled",
        "--gradient_checkpointing",
        "--blocks_to_swap", "16",
        "--sdpa",
        "--output_dir", output_dir,
        "--output_name", output_name,
        "--save_every_n_steps", str(train["saveEvery"]),
        "--max_data_loader_n_workers", "0",
        "--seed", str(train["seed"]),
        "--timestep_sampling", "shift",
        "--discrete_flow_shift", "3.0",
        "--no_metadata",
    ]
    add_continue_args(cmd, request)
    run(cmd, cwd=MUSUBI_ROOT, env=gpu_env, run_dir=run_dir)


def run_klein9b_training(request: dict[str, Any], run_dir: Path) -> None:
    train = request.get("train") or {}
    dataset_toml = str(run_dir / "dataset.toml")
    output_dir = str(run_dir / "output")
    output_name = expected_output_file(request, run_dir).stem
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = str(GPU_ID)
    env["PYTHONPATH"] = str(MUSUBI_ROOT / "src")

    update_status(run_dir, {"phase": "cache_latents", "message": "caching latents", "progress": 0.15})
    run([KLEIN_PY, "src/musubi_tuner/flux_2_cache_latents.py",
         "--dataset_config", dataset_toml,
         "--vae", KLEIN9B_VAE,
         "--model_version", "klein-base-9b",
         "--vae_dtype", "bfloat16"], cwd=MUSUBI_ROOT, env=env, run_dir=run_dir)

    update_status(run_dir, {"phase": "cache_text_encoder", "message": "caching text encoder outputs", "progress": 0.30})
    run([KLEIN_PY, "src/musubi_tuner/flux_2_cache_text_encoder_outputs.py",
         "--dataset_config", dataset_toml,
         "--text_encoder", KLEIN9B_TEXT_ENCODER,
         "--batch_size", "8",
         "--model_version", "klein-base-9b"], cwd=MUSUBI_ROOT, env=env, run_dir=run_dir)

    update_status(run_dir, {
        "phase": "training",
        "message": "training",
        "progress": 0.45,
        "currentStep": 0,
        "totalSteps": int(train["steps"]),
    })
    cmd = [
        str(Path(KLEIN_PY).parent / "accelerate"), "launch",
        "--config_file", ACCELERATE_CONFIG,
        "--num_cpu_threads_per_process", "1",
        "--mixed_precision", "bf16",
        "src/musubi_tuner/flux_2_train_network.py",
        "--model_version", "klein-base-9b",
        "--dit", KLEIN9B_DIT,
        "--vae", KLEIN9B_VAE,
        "--text_encoder", KLEIN9B_TEXT_ENCODER,
        "--dataset_config", dataset_toml,
        "--sdpa",
        "--mixed_precision", "bf16",
        "--timestep_sampling", "flux2_shift",
        "--weighting_scheme", "none",
        "--optimizer_type", "adamw8bit",
        "--learning_rate", str(train["lr"]),
        "--gradient_checkpointing",
        "--max_data_loader_n_workers", "2",
        "--persistent_data_loader_workers",
        "--network_module", "networks.lora_flux_2",
        "--network_dim", str(train["rank"]),
        "--network_alpha", str(train["alpha"]),
        "--max_train_steps", str(train["steps"]),
        "--save_every_n_steps", str(train["saveEvery"]),
        "--seed", str(train["seed"]),
        "--output_dir", output_dir,
        "--output_name", output_name,
    ]
    add_continue_args(cmd, request)
    run(cmd, cwd=MUSUBI_ROOT, env=env, run_dir=run_dir)


def add_continue_args(cmd: list[str], request: dict[str, Any]) -> None:
    continue_from = request.get("continueFrom") or {}
    lora_path = continue_from.get("loraPath")
    if request.get("mode") == "continue_weights" and lora_path:
        cmd.extend(["--network_weights", str(lora_path)])


def validate_request(request: dict[str, Any]) -> None:
    required = ["taskId", "projectId", "mode", "baseProfile", "lora", "dataset", "train", "publish"]
    missing = [key for key in required if key not in request]
    if missing:
        raise ValueError(f"missing request fields: {missing}")
    if request["mode"] not in {"initial", "continue_weights"}:
        raise ValueError("mode must be initial or continue_weights")
    if request["baseProfile"] not in {"flux2_dev_bf16", "flux2_klein9b"}:
        raise ValueError("baseProfile must be flux2_dev_bf16 or flux2_klein9b")
    lora = request["lora"]
    if not SAFE_NAME_RE.match(str(lora.get("name") or "")):
        raise ValueError("lora.name contains unsupported characters")
    if not str(lora.get("trigger") or "").strip():
        raise ValueError("lora.trigger is required")
    dataset_uri = str((request.get("dataset") or {}).get("uri") or "")
    if not dataset_uri.startswith("s3://") or not dataset_uri.endswith("/"):
        raise ValueError("dataset.uri must be an s3:// prefix ending with /")
    if request["mode"] == "continue_weights" and not (request.get("continueFrom") or {}).get("loraPath"):
        raise ValueError("continueFrom.loraPath is required for continue_weights")


def expected_output_file(request: dict[str, Any], run_dir: Path) -> Path:
    lora = request["lora"]
    publish = request.get("publish") or {}
    filename = str(publish.get("filename") or f"{lora['name']}.safetensors")
    return run_dir / "output" / filename


def write_metadata(
    request: dict[str, Any],
    run_dir: Path,
    local_path: Path,
    metadata_path: Path,
    state: dict[str, Any],
) -> None:
    metadata = {
        "schemaVersion": 1,
        "name": request["lora"]["name"],
        "kind": request["lora"].get("kind", "style"),
        "trigger": request["lora"]["trigger"],
        "baseProfile": request["baseProfile"],
        "mode": request["mode"],
        "datasetUri": request["dataset"]["uri"],
        "train": request.get("train") or {},
        "publishMode": "local",
        "localPath": str(local_path),
        "runDir": str(run_dir),
        "createdAt": state.get("startedAt") or utc_now(),
        "finishedAt": state.get("finishedAt"),
    }
    if request.get("continueFrom"):
        metadata["continuedFrom"] = request["continueFrom"]
    write_json(metadata_path, metadata)


def write_minimal_safetensors(path: Path, metadata: dict[str, str]) -> None:
    header = {"__metadata__": metadata}
    raw = json.dumps(header, separators=(",", ":")).encode("utf-8")
    path.write_bytes(struct.pack("<Q", len(raw)) + raw)


def parse_s3_uri(uri: str) -> tuple[str, str]:
    rest = uri[len("s3://"):]
    bucket, _, prefix = rest.partition("/")
    if not bucket or not prefix:
        raise ValueError(f"invalid s3 uri: {uri}")
    return bucket, prefix


def list_s3_objects(bucket: str, prefix: str) -> list[tuple[str, int]]:
    result = run_json(["aws", "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix])
    return [
        (str(item.get("Key") or ""), int(item.get("Size") or 0))
        for item in result.get("Contents", [])
        if item.get("Key")
    ]


def run_json(cmd: list[str]) -> dict[str, Any]:
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(result.stdout or "{}")


def run(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    run_dir: Path,
) -> None:
    log(run_dir, "$ " + " ".join(map(str, cmd)))
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=env, check=True)


def write_status(run_dir: Path, state: dict[str, Any]) -> None:
    base = {
        "jobId": run_dir.name,
        "runDir": str(run_dir),
        "statusPath": str(run_dir / "status.json"),
        "logPath": str(run_dir / "train.log"),
        "outputDir": str(run_dir / "output"),
    }
    base.update(state)
    write_json(run_dir / "status.json", base)


def update_status(run_dir: Path, patch: dict[str, Any]) -> None:
    state = read_status(run_dir)
    if "startedAt" not in state:
        state["startedAt"] = utc_now()
    state.update(patch)
    write_status(run_dir, state)


def read_status(run_dir: Path) -> dict[str, Any]:
    path = run_dir / "status.json"
    if not path.exists():
        return {}
    return read_json(path)


def public_status(job_id: str, run_dir: Path, state: dict[str, Any]) -> dict[str, Any]:
    out = dict(state)
    out.update({
        "jobId": job_id,
        "runDir": str(run_dir),
        "statusPath": str(run_dir / "status.json"),
        "logPath": str(run_dir / "train.log"),
        "outputDir": str(run_dir / "output"),
    })
    return out


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def job_run_dir(job_id: str) -> Path:
    if not re.match(r"^train_[a-f0-9]{12}$", job_id):
        raise ValueError(f"invalid job id: {job_id}")
    run_dir = RUNS_DIR / job_id
    if not run_dir.is_dir():
        raise ValueError(f"job not found: {job_id}")
    return run_dir


def pid_alive(run_dir: Path) -> bool:
    pid_file = run_dir / "pid.json"
    if not pid_file.exists():
        return False
    try:
        pid = int(read_json(pid_file).get("pid") or 0)
    except Exception:
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def tail_lines(path: Path, max_lines: int = 40) -> list[str]:
    if not path.exists():
        return []
    return path.read_text(encoding="utf-8", errors="replace").splitlines()[-max_lines:]


def log(run_dir: Path, message: str) -> None:
    line = f"{datetime.now().strftime('%H:%M:%S')} {message}"
    print(line, flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def print_json(data: dict[str, Any]) -> None:
    print(json.dumps(data, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    raise SystemExit(main())
