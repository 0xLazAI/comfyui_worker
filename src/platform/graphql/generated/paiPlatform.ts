import type { GraphQLClient, RequestOptions } from 'graphql-request';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
type GraphQLClientRequestHeaders = RequestOptions['requestHeaders'];
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  JSON: { input: unknown; output: unknown; }
};

export type AgentChatInput = {
  jobId?: InputMaybe<Scalars['String']['input']>;
  message: Scalars['String']['input'];
  panelId?: InputMaybe<Scalars['String']['input']>;
  projectId: Scalars['String']['input'];
  sceneId?: InputMaybe<Scalars['String']['input']>;
  threadId?: InputMaybe<Scalars['String']['input']>;
};

export type AgentChatResult = {
  __typename?: 'AgentChatResult';
  actions: Array<Scalars['JSON']['output']>;
  contextUsed?: Maybe<Scalars['JSON']['output']>;
  meta?: Maybe<Scalars['JSON']['output']>;
  summary: Scalars['String']['output'];
  warnings: Array<Scalars['String']['output']>;
  widgets?: Maybe<Scalars['JSON']['output']>;
};

export type AgentContext = {
  __typename?: 'AgentContext';
  focus: Scalars['JSON']['output'];
};

export type AgentContextInput = {
  include?: InputMaybe<Array<Scalars['String']['input']>>;
  jobId?: InputMaybe<Scalars['String']['input']>;
  panelId?: InputMaybe<Scalars['String']['input']>;
  projectId: Scalars['String']['input'];
  sceneId?: InputMaybe<Scalars['String']['input']>;
  threadId?: InputMaybe<Scalars['String']['input']>;
};

export enum AssetKind {
  Annotation = 'ANNOTATION',
  EntityImage = 'ENTITY_IMAGE',
  EntityModel_3D = 'ENTITY_MODEL_3D',
  Render = 'RENDER',
  SourceScript = 'SOURCE_SCRIPT',
  Storyboard = 'STORYBOARD'
}

export type AssetUploadUrl = {
  __typename?: 'AssetUploadUrl';
  assetsUri: Scalars['String']['output'];
  expiresIn: Scalars['Int']['output'];
  headers: Scalars['JSON']['output'];
  objectKey: Scalars['String']['output'];
  uploadUrl: Scalars['String']['output'];
};

export type AssetUrl = {
  __typename?: 'AssetUrl';
  assetsUri: Scalars['String']['output'];
  url: Scalars['String']['output'];
};

export type AuthPayload = {
  __typename?: 'AuthPayload';
  token: Scalars['String']['output'];
  user: User;
};

export type ChatMessage = {
  __typename?: 'ChatMessage';
  contentJson?: Maybe<Scalars['JSON']['output']>;
  contentText: Scalars['String']['output'];
  createdAt?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  projectId?: Maybe<Scalars['String']['output']>;
  role: Scalars['String']['output'];
  status: Scalars['String']['output'];
  threadId: Scalars['String']['output'];
};

export type ChatMessageInput = {
  contentJson?: InputMaybe<Scalars['JSON']['input']>;
  contentText: Scalars['String']['input'];
};

export type ChatThread = {
  __typename?: 'ChatThread';
  createdAt?: Maybe<Scalars['String']['output']>;
  createdBy?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  projectId: Scalars['String']['output'];
  relatedJobId?: Maybe<Scalars['String']['output']>;
  relatedPanelId?: Maybe<Scalars['String']['output']>;
  relatedSceneId?: Maybe<Scalars['String']['output']>;
  scope: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
};

export type ChatThreadInput = {
  projectId: Scalars['String']['input'];
  relatedJobId?: InputMaybe<Scalars['String']['input']>;
  relatedPanelId?: InputMaybe<Scalars['String']['input']>;
  relatedSceneId?: InputMaybe<Scalars['String']['input']>;
  scope?: InputMaybe<Scalars['String']['input']>;
  title: Scalars['String']['input'];
};

export type CreateProjectInput = {
  name: Scalars['String']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type Job = {
  __typename?: 'Job';
  error?: Maybe<Scalars['String']['output']>;
  eta?: Maybe<Scalars['Int']['output']>;
  filename?: Maybe<Scalars['String']['output']>;
  jobId: Scalars['String']['output'];
  kind?: Maybe<Scalars['String']['output']>;
  progress?: Maybe<Scalars['Float']['output']>;
  project?: Maybe<Scalars['String']['output']>;
  renderUrl?: Maybe<Scalars['String']['output']>;
  renderUrls: Array<Scalars['String']['output']>;
  result: Array<Scalars['String']['output']>;
  sceneCount?: Maybe<Scalars['Int']['output']>;
  seed?: Maybe<Scalars['Int']['output']>;
  status?: Maybe<Scalars['String']['output']>;
};

export type JobDebug = {
  __typename?: 'JobDebug';
  diagnostics: Scalars['JSON']['output'];
  job: Scalars['JSON']['output'];
  request: Scalars['JSON']['output'];
  result: Scalars['JSON']['output'];
  worker?: Maybe<Scalars['JSON']['output']>;
  workerTask?: Maybe<Scalars['JSON']['output']>;
};

export type LogoutPayload = {
  __typename?: 'LogoutPayload';
  loggedOut: Scalars['Boolean']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  addChatMessage: ChatMessage;
  cleanProjectWorktree: ProjectVersionCleanResult;
  commitProjectVersion: ProjectVersionCommitResult;
  createAssetUploadUrl: AssetUploadUrl;
  createChatThread: ChatThread;
  createProject: ProjectCreateResult;
  deletePaceFiles: PaceFilesDeleteResult;
  deleteProject: ProjectDeleteResult;
  deleteProjectVersion: ProjectVersionDeleteResult;
  heartbeatWorker: WorkerHeartbeatResult;
  login: AuthPayload;
  logout: LogoutPayload;
  register: AuthPayload;
  registerWorker: WorkerRegistrationResult;
  restoreProjectVersion: ProjectVersionRestoreResult;
  runWorkerTask: WorkerTaskSubmitResult;
  sendAgentMessage: AgentChatResult;
  updateWorkerRegistration: WorkerRegistrationResult;
  writePaceFiles: PaceFilesWriteResult;
};


export type MutationAddChatMessageArgs = {
  input: ChatMessageInput;
  threadId: Scalars['String']['input'];
};


export type MutationCleanProjectWorktreeArgs = {
  projectId: Scalars['String']['input'];
};


export type MutationCommitProjectVersionArgs = {
  comment: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};


export type MutationCreateAssetUploadUrlArgs = {
  assetKind: AssetKind;
  contentType: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};


export type MutationCreateChatThreadArgs = {
  input: ChatThreadInput;
};


export type MutationCreateProjectArgs = {
  input: CreateProjectInput;
};


export type MutationDeletePaceFilesArgs = {
  paths: Array<Scalars['String']['input']>;
  projectId: Scalars['String']['input'];
};


export type MutationDeleteProjectArgs = {
  projectId: Scalars['String']['input'];
};


export type MutationDeleteProjectVersionArgs = {
  projectId: Scalars['String']['input'];
  versionId: Scalars['String']['input'];
};


export type MutationHeartbeatWorkerArgs = {
  input: WorkerHeartbeatInput;
  workerName: Scalars['String']['input'];
};


export type MutationLoginArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationRegisterArgs = {
  displayName: Scalars['String']['input'];
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationRegisterWorkerArgs = {
  input: WorkerRegistrationInput;
};


export type MutationRestoreProjectVersionArgs = {
  projectId: Scalars['String']['input'];
  versionId: Scalars['String']['input'];
};


export type MutationRunWorkerTaskArgs = {
  payload?: InputMaybe<Scalars['JSON']['input']>;
  projectId: Scalars['String']['input'];
  taskType: Scalars['String']['input'];
  workerName: Scalars['String']['input'];
};


export type MutationSendAgentMessageArgs = {
  input: AgentChatInput;
};


export type MutationUpdateWorkerRegistrationArgs = {
  input: WorkerRegistrationInput;
  workerName: Scalars['String']['input'];
};


export type MutationWritePaceFilesArgs = {
  patches?: InputMaybe<Array<PaceFilePatchInput>>;
  projectId: Scalars['String']['input'];
  writes?: InputMaybe<Array<PaceFileWriteInput>>;
};

export type PaceArtifactItem = {
  __typename?: 'PaceArtifactItem';
  /** 记录创建时间,使用 ISO 8601 字符串。 */
  createdAt?: Maybe<Scalars['String']['output']>;
  /** 创建者或创建来源。 */
  createdBy?: Maybe<Scalars['JSON']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 原始文件名或展示名,非路径真值 */
  filename?: Maybe<Scalars['String']['output']>;
  /** 产物类型,如 source_script_file/source_script_text/storyboard_pdf/storyboard_html/v1_storyboard/reference_video/blender_file/previs_take/final_take/audio_mix/...;source_script_file 表示前端/平台上传的原始剧本文件,可作为 split_script 输入源;source_script_text 表示解析后或规范化后的剧本文本,二者可共存。 */
  kind: Scalars['String']['output'];
  /** MIME type,如 application/pdf 或 text/html */
  mediaType?: Maybe<Scalars['String']['output']>;
  /** 备注。 */
  note?: Maybe<Scalars['String']['output']>;
  /** 仅 shot/panel 级产物使用;项目级和场景级产物不填 */
  panelId?: Maybe<Scalars['String']['output']>;
  /** 产物来源 */
  source?: Maybe<PaceArtifactItemSourceEnum>;
  /** 产物状态;默认语义为 ready */
  status?: Maybe<PaceArtifactItemStatusEnum>;
  /** 被当前记录取代的 artifact/version id */
  supersedesId?: Maybe<Scalars['String']['output']>;
  /** 标签列表。 */
  tags?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 二进制或大文件一律对象存储 assets:// URI;不得持久化签名 URL / CDN URL / HTTP(S) URL */
  uri: Scalars['String']['output'];
  /** 可选 take / 修订 id */
  versionId?: Maybe<Scalars['String']['output']>;
};


export type PaceArtifactItemFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceArtifactItemSourceEnum {
  Imported = 'imported',
  ToolGenerated = 'tool_generated',
  Uploaded = 'uploaded',
  WorkerGenerated = 'worker_generated'
}

export enum PaceArtifactItemStatusEnum {
  Failed = 'failed',
  Processing = 'processing',
  Ready = 'ready',
  Rejected = 'rejected'
}

/** 角色造型卡,用于资产库按造型渲染。 */
export type PaceAssetAppearance = {
  __typename?: 'PaceAssetAppearance';
  /** 角色年龄或阶段状态。 */
  ageState?: Maybe<Scalars['String']['output']>;
  /** 服装描述。 */
  costume?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 图像资产引用。 */
  image?: Maybe<PaceAssetRef>;
  /** 三维模型资产引用。 */
  model3d?: Maybe<PaceAssetRef>;
};


/** 角色造型卡,用于资产库按造型渲染。 */
export type PaceAssetAppearanceFieldArgs = {
  path: Scalars['String']['input'];
};

/** 资产在某种年龄、服装、状态或场景下的表现。 */
export type PaceAssetDepiction = {
  __typename?: 'PaceAssetDepiction';
  /** 角色年龄或阶段状态。 */
  ageState?: Maybe<Scalars['String']['output']>;
  /** 服装描述。 */
  costume?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 图像资产引用。 */
  image?: Maybe<PaceAssetRef>;
  /** 妆发或配饰备注。 */
  makeup?: Maybe<Scalars['String']['output']>;
  /** 三维模型资产引用。 */
  model3d?: Maybe<PaceAssetRef>;
  /** 该表现适用的单个场景 ID。 */
  sceneId?: Maybe<Scalars['String']['output']>;
  /** 适用场景 ID 列表。 */
  scenes?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 道具或资产状态。 */
  state?: Maybe<Scalars['String']['output']>;
};


/** 资产在某种年龄、服装、状态或场景下的表现。 */
export type PaceAssetDepictionFieldArgs = {
  path: Scalars['String']['input'];
};

export type PaceAssetEntry = {
  __typename?: 'PaceAssetEntry';
  /** 年龄态字典或 map。 */
  ageStates?: Maybe<Scalars['JSON']['output']>;
  /** 参考锚或形象锚。 */
  anchor?: Maybe<Scalars['String']['output']>;
  /** 动画或运动配置。 */
  animation?: Maybe<Scalars['JSON']['output']>;
  /** 角色造型卡列表。 */
  appearances?: Maybe<Array<Maybe<PaceAssetAppearance>>>;
  /** 外部系统资产 ID 或迁移来源 ID。PACE 内部引用必须优先使用 id。 */
  assetId?: Maybe<Scalars['String']['output']>;
  /** 道具或资产分类。 */
  category?: Maybe<Scalars['String']['output']>;
  /** 连续性卡片逐行条目。 */
  continuityCard?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 连续性状态字典或 map。 */
  continuityStates?: Maybe<Scalars['JSON']['output']>;
  /** 服装字典或 map。 */
  costumes?: Maybe<Scalars['JSON']['output']>;
  /** 资产在不同状态或场景中的表现列表。 */
  depictions?: Maybe<Array<Maybe<PaceAssetDepiction>>>;
  /** 实体描述。 */
  description?: Maybe<Scalars['String']['output']>;
  /** 导演备注。 */
  directorNotes?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 通用形象锚字典或 map。 */
  genericAnchors?: Maybe<Scalars['JSON']['output']>;
  /** PACE 资产 canonical ID。必须小写并带类型前缀:char_/prop_/loc_/voice_,例如 char_yan_liang、prop_green_dragon_saber、loc_xuchang_camp、voice_yan_liang_main。版本信息写入 version 字段;引用字段可在 ID 后追加 @version。 */
  id: Scalars['String']['output'];
  /** 图像资产引用。 */
  image?: Maybe<PaceAssetRef>;
  /** LoRA 资产引用。 */
  lora?: Maybe<Scalars['JSON']['output']>;
  /** 三维模型资产引用。 */
  model3d?: Maybe<PaceAssetRef>;
  /** 显示名称。 */
  name?: Maybe<Scalars['String']['output']>;
  /** 物理属性字典或 map。 */
  physicalAttributes?: Maybe<Scalars['JSON']['output']>;
  /** 制作备注。 */
  productionNotes?: Maybe<Scalars['String']['output']>;
  /** 外部或内部引用集合。 */
  refs?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 出现的 scene ID 列表。 */
  scenes?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 地点设定,如内景/外景等。 */
  setting?: Maybe<Scalars['String']['output']>;
  /** 出现的 shot ID 列表。 */
  shots?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 角色或资产分级。 */
  tier?: Maybe<Scalars['String']['output']>;
  /** LoRA 或形象触发词。 */
  trigger?: Maybe<Scalars['String']['output']>;
  /** 资产版本标签。 */
  version?: Maybe<Scalars['String']['output']>;
  /** 语音或音色 ID。 */
  voiceId?: Maybe<Scalars['String']['output']>;
};


export type PaceAssetEntryFieldArgs = {
  path: Scalars['String']['input'];
};

/** 文件:entities/characters.json、entities/props.json、entities/locations.json、entities/voices.json。实体资产台账 schema,定义角色、道具、地点、声音等资产索引及其 depictions 表示。 */
export type PaceAssetIndex = {
  __typename?: 'PaceAssetIndex';
  field?: Maybe<Scalars['JSON']['output']>;
  items: Array<Maybe<PaceAssetEntry>>;
};


/** 文件:entities/characters.json、entities/props.json、entities/locations.json、entities/voices.json。实体资产台账 schema,定义角色、道具、地点、声音等资产索引及其 depictions 表示。 */
export type PaceAssetIndexFieldArgs = {
  path: Scalars['String']['input'];
};

export type PaceAssetRef = {
  __typename?: 'PaceAssetRef';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 字段或记录来源。 */
  source?: Maybe<Scalars['JSON']['output']>;
  /** 当前状态。 */
  status?: Maybe<PaceAssetRefStatusEnum>;
  /** assets:// URI。 */
  uri?: Maybe<Scalars['String']['output']>;
};


export type PaceAssetRefFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceAssetRefStatusEnum {
  Failed = 'failed',
  Generating = 'generating',
  Idle = 'idle',
  Ready = 'ready'
}

/** 文件:delivery/delivery_manifest.json(08 目录树中 delivery/ 下唯一的文件)。交付清单:master/分镜片段的 assets:// 引用 + 规格 + 校验和。owner:S3/POST 阶段写,QA 验收读。 */
export type PaceDeliveryManifest = {
  __typename?: 'PaceDeliveryManifest';
  /** 验收人(人名/账号);null = 未验收 */
  approvedBy?: Maybe<Scalars['String']['output']>;
  /** ISO 8601 时间戳 */
  createdAt?: Maybe<Scalars['String']['output']>;
  /** 交付项列表,append-only:只增不改;重交付 = 追加新条目 + 新 versionId,旧条目保留作血缘 */
  deliverables: Array<Maybe<PaceDeliveryManifestDeliverablesItem>>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 项目 ID(与工程目录根一致) */
  projectId: Scalars['String']['output'];
  /** 标准版本号 */
  schemaVersion: Scalars['String']['output'];
};


/** 文件:delivery/delivery_manifest.json(08 目录树中 delivery/ 下唯一的文件)。交付清单:master/分镜片段的 assets:// 引用 + 规格 + 校验和。owner:S3/POST 阶段写,QA 验收读。 */
export type PaceDeliveryManifestFieldArgs = {
  path: Scalars['String']['input'];
};

export type PaceDeliveryManifestDeliverablesItem = {
  __typename?: 'PaceDeliveryManifestDeliverablesItem';
  /** 完整性校验和(交付验收依据) */
  checksum?: Maybe<PaceDeliveryManifestDeliverablesItemChecksum>;
  /** 时长(秒) */
  durationS?: Maybe<Scalars['Float']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 容器/编码,如 mp4/h264、mov/prores422、wav/pcm24 */
  format?: Maybe<Scalars['String']['output']>;
  /** 有理数帧率(23.976=24000/1001),禁浮点——与 camera.fps 同规则(C-C) */
  fps?: Maybe<PaceDeliveryManifestDeliverablesItemFps>;
  /** master=成片 / scene_cut=场级剪段 / shot_take=镜头级片段 / trailer=预告 / audio_mix=混音轨 / subtitle=字幕 / other=其余(note 必须说明) */
  kind: PaceDeliveryManifestDeliverablesItemKindEnum;
  /** 给人看的备注(kind=other 时必填说明) */
  note?: Maybe<Scalars['String']['output']>;
  /** [宽, 高] 像素 */
  resolution?: Maybe<Array<Maybe<Scalars['Int']['output']>>>;
  /** kind=scene_cut/shot_take 时填;结构 ID(s001) */
  sceneId?: Maybe<Scalars['String']['output']>;
  /** kind=shot_take 时填;结构 ID(hs001_sh003) */
  shotId?: Maybe<Scalars['String']['output']>;
  /** 二进制成片一律 assets:// URI(契约 §4.1);字幕等纯文本允许工程内相对路径 */
  uri: Scalars['String']['output'];
  /** 对应 semantics.version 血缘链中的 take id(交付物可溯源到具体 take) */
  versionId?: Maybe<Scalars['String']['output']>;
};


export type PaceDeliveryManifestDeliverablesItemFieldArgs = {
  path: Scalars['String']['input'];
};

/** 完整性校验和(交付验收依据) */
export type PaceDeliveryManifestDeliverablesItemChecksum = {
  __typename?: 'PaceDeliveryManifestDeliverablesItemChecksum';
  /** 摘要算法,新交付建议 sha256 */
  algo: PaceDeliveryManifestDeliverablesItemChecksumAlgoEnum;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 十六进制摘要值 */
  value: Scalars['String']['output'];
};


/** 完整性校验和(交付验收依据) */
export type PaceDeliveryManifestDeliverablesItemChecksumFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceDeliveryManifestDeliverablesItemChecksumAlgoEnum {
  Md5 = 'md5',
  Sha256 = 'sha256'
}

/** 有理数帧率(23.976=24000/1001),禁浮点——与 camera.fps 同规则(C-C) */
export type PaceDeliveryManifestDeliverablesItemFps = {
  __typename?: 'PaceDeliveryManifestDeliverablesItemFps';
  /** 分母 */
  denom: Scalars['Int']['output'];
  field?: Maybe<Scalars['JSON']['output']>;
  /** 分子 */
  num: Scalars['Int']['output'];
};


/** 有理数帧率(23.976=24000/1001),禁浮点——与 camera.fps 同规则(C-C) */
export type PaceDeliveryManifestDeliverablesItemFpsFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceDeliveryManifestDeliverablesItemKindEnum {
  AudioMix = 'audio_mix',
  Master = 'master',
  Other = 'other',
  SceneCut = 'scene_cut',
  ShotTake = 'shot_take',
  Subtitle = 'subtitle',
  Trailer = 'trailer'
}

export type PaceDocument = PaceAssetIndex | PaceDeliveryManifest | PaceGenericDocument | PacePanelManifest | PaceProjectManifest | PaceSceneManifest | PaceShotManifest;

export type PaceFile = {
  __typename?: 'PaceFile';
  document: PaceDocument;
  format: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  path: Scalars['String']['output'];
  project: Scalars['String']['output'];
  sizeBytes: Scalars['Int']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
  value: Scalars['JSON']['output'];
};

export type PaceFileMeta = {
  __typename?: 'PaceFileMeta';
  format: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  path: Scalars['String']['output'];
  project: Scalars['String']['output'];
  sizeBytes: Scalars['Int']['output'];
  updatedAt?: Maybe<Scalars['String']['output']>;
};

export type PaceFilePatchInput = {
  operations: Array<PaceFilePatchOperationInput>;
  path: Scalars['String']['input'];
};

export enum PaceFilePatchOp {
  Add = 'ADD',
  Remove = 'REMOVE',
  Replace = 'REPLACE'
}

export type PaceFilePatchOperationInput = {
  op: PaceFilePatchOp;
  path: Scalars['String']['input'];
  value?: InputMaybe<Scalars['JSON']['input']>;
};

export type PaceFileWriteInput = {
  path: Scalars['String']['input'];
  value: Scalars['JSON']['input'];
};

export type PaceFilesChangedItem = {
  __typename?: 'PaceFilesChangedItem';
  format: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  path: Scalars['String']['output'];
};

export type PaceFilesDeleteResult = {
  __typename?: 'PaceFilesDeleteResult';
  deleted: Array<PaceFilesDeletedItem>;
  project: Scalars['String']['output'];
  recycled: Array<PaceFilesRecycledItem>;
  validation: PaceValidation;
};

export type PaceFilesDeletedItem = {
  __typename?: 'PaceFilesDeletedItem';
  path: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type PaceFilesRecycledItem = {
  __typename?: 'PaceFilesRecycledItem';
  path: Scalars['String']['output'];
  recycledPath: Scalars['String']['output'];
};

export type PaceFilesWriteResult = {
  __typename?: 'PaceFilesWriteResult';
  changed: Array<PaceFilesChangedItem>;
  project: Scalars['String']['output'];
  validation: PaceValidation;
};

export enum PaceForegroundEnum {
  Focal = 'focal',
  Global = 'global',
  Local = 'local'
}

/** target_* 与 direction 二选一 */
export type PaceGaze = {
  __typename?: 'PaceGaze';
  /** 方向。 */
  direction?: Maybe<PaceGazeDirectionEnum>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 备注。 */
  note?: Maybe<Scalars['String']['output']>;
  /** 注视目标引用。 */
  targetRef?: Maybe<Scalars['String']['output']>;
  /** 注视目标类型。 */
  targetType?: Maybe<PaceGazeTargetTypeEnum>;
};


/** target_* 与 direction 二选一 */
export type PaceGazeFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceGazeDirectionEnum {
  Averted = 'averted',
  Down = 'down',
  IntoCamera = 'into_camera',
  Left = 'left',
  OffDown = 'off_down',
  OffLeft = 'off_left',
  OffRight = 'off_right',
  OffUp = 'off_up',
  Right = 'right',
  Up = 'up'
}

export enum PaceGazeTargetTypeEnum {
  Camera = 'camera',
  Character = 'character',
  Feature = 'feature',
  Object = 'object'
}

export type PaceGenericDocument = {
  __typename?: 'PaceGenericDocument';
  field?: Maybe<Scalars['JSON']['output']>;
};


export type PaceGenericDocumentFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceLightRoleEnum {
  BackLight = 'back_light',
  FillLight = 'fill_light',
  KeyLight = 'key_light',
  SideLight = 'side_light',
  TopLight = 'top_light'
}

/** 文件:scenes/<sceneId>/shots/<shotId>/panels/<panelId>/manifest.json。panel = 唯一被渲染的叶子,**panel 层单一真值**。panel 不再承载四柱 override;四柱真值在 shot 层。required:schemaVersion+panelId。owner:S1 建骨架。 */
export type PacePanelManifest = {
  __typename?: 'PacePanelManifest';
  /** panel 级产物索引(append-only),如该关键帧的标注 JSON、参考图或局部输出。 */
  artifacts?: Maybe<Array<Maybe<PaceArtifactItem>>>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 是否作为关键帧参与渲染/批量网格;为空表示由 worker 默认策略决定。 */
  isKeyframe?: Maybe<Scalars['Boolean']['output']>;
  /** visual=正常画面 / title_card=字卡 / black=黑屏过场 / meta=非渲染占位;仅 visual 进图像后端 */
  kind?: Maybe<PacePanelManifestKindEnum>;
  /** panel 级渲染模型/工作流选择;为空表示使用 worker 或项目默认值。 */
  model?: Maybe<Scalars['String']['output']>;
  /** 给人看的备注;编译器不消费 */
  notes?: Maybe<Scalars['String']['output']>;
  /** 结构 ID(平台契约 §4.3,如 ps001_sh003_p0001);与所属 panel 目录名一致 */
  panelId: Scalars['String']['output'];
  /** shot 内序号,从 1 起 */
  panelNumber?: Maybe<Scalars['Int']['output']>;
  /** override:仅当该 panel 焦点与 shot 级 setup.primaryFocus 不同时才写;真值在 shot 级,缺失即继承(形状同 setup.primaryFocus:{type, ref, ofCharacter?, coveragePct?}) */
  primaryFocus?: Maybe<PacePanelManifestPrimaryFocus>;
  /** 前镜/连续性参考图的 assets:// URI;不得保存签名 URL 或 HTTP(S) URL。 */
  sceneReference?: Maybe<Scalars['String']['output']>;
  /** 标准版本号 */
  schemaVersion: Scalars['String']['output'];
  /** panel 级渲染随机种子;为空表示由 worker 自动生成。 */
  seed?: Maybe<Scalars['Int']['output']>;
  /** 风格参考图 assets:// URI 列表;不得保存签名 URL 或 HTTP(S) URL。 */
  styleReferences?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
};


/** 文件:scenes/<sceneId>/shots/<shotId>/panels/<panelId>/manifest.json。panel = 唯一被渲染的叶子,**panel 层单一真值**。panel 不再承载四柱 override;四柱真值在 shot 层。required:schemaVersion+panelId。owner:S1 建骨架。 */
export type PacePanelManifestFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePanelManifestKindEnum {
  Black = 'black',
  Meta = 'meta',
  TitleCard = 'title_card',
  Visual = 'visual'
}

/** override:仅当该 panel 焦点与 shot 级 setup.primaryFocus 不同时才写;真值在 shot 级,缺失即继承(形状同 setup.primaryFocus:{type, ref, ofCharacter?, coveragePct?}) */
export type PacePanelManifestPrimaryFocus = {
  __typename?: 'PacePanelManifestPrimaryFocus';
  /** 画面覆盖比例,0 到 100。 */
  coveragePct?: Maybe<Scalars['Int']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** type=feature 时必填。角色资产 ID,可追加 @version。 */
  ofCharacter?: Maybe<Scalars['String']['output']>;
  /** 实体或资产引用。 */
  ref: Scalars['String']['output'];
  /** 对象类型。 */
  type: PacePanelManifestPrimaryFocusTypeEnum;
};


/** override:仅当该 panel 焦点与 shot 级 setup.primaryFocus 不同时才写;真值在 shot 级,缺失即继承(形状同 setup.primaryFocus:{type, ref, ofCharacter?, coveragePct?}) */
export type PacePanelManifestPrimaryFocusFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePanelManifestPrimaryFocusTypeEnum {
  Character = 'character',
  Environment = 'environment',
  Feature = 'feature',
  Object = 'object'
}

/** PACE camera pillar schema。定义镜头摄影机、镜头语言和运动轨迹真值。 */
export type PacePillarCamera = {
  __typename?: 'PacePillarCamera';
  /** 镜头创作意图。 */
  creativeIntent?: Maybe<PacePillarCameraCreativeIntent>;
  /** 摄影机外参、机位和朝向。 */
  extrinsics?: Maybe<PacePillarCameraExtrinsics>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 有理数帧率(23.976=24000/1001), 禁浮点(C-C) */
  fps?: Maybe<PacePillarCameraFps>;
  /** 帧范围。 */
  frameRange?: Maybe<Array<Maybe<Scalars['Int']['output']>>>;
  /** 摄影机内参和镜头参数。 */
  intrinsics?: Maybe<PacePillarCameraIntrinsics>;
  /** 运镜程序(自 PAILang camera.program 吸收转正——此前是其 studio 写入的越 schema 野字段)。与 trajectory 的关系:program 是「怎么算出轨迹」的可复现配方(真值),trajectory.camera_path 是算出来的 6-DoF 关键帧 artifact(产物);两者并存,符合「字段是真值,prompt/轨迹是产物」铁律。 */
  program?: Maybe<PacePillarCameraProgram>;
  /** 摄影机运动轨迹。 */
  trajectory?: Maybe<PacePillarCameraTrajectory>;
};


/** PACE camera pillar schema。定义镜头摄影机、镜头语言和运动轨迹真值。 */
export type PacePillarCameraFieldArgs = {
  path: Scalars['String']['input'];
};

/** 镜头创作意图。 */
export type PacePillarCameraCreativeIntent = {
  __typename?: 'PacePillarCameraCreativeIntent';
  /** 画幅比例。 */
  aspectRatio?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 构图方式。 */
  framing?: Maybe<PacePillarCameraCreativeIntentFramingEnum>;
  /** 景别。 */
  shotSize?: Maybe<PacePillarCameraCreativeIntentShotSizeEnum>;
};


/** 镜头创作意图。 */
export type PacePillarCameraCreativeIntentFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarCameraCreativeIntentFramingEnum {
  Crowd = 'crowd',
  Empty = 'empty',
  Insert = 'insert',
  Ots = 'ots',
  Pov = 'pov',
  Single = 'single',
  TwoShot = 'two_shot'
}

export enum PacePillarCameraCreativeIntentShotSizeEnum {
  CloseUp = 'close_up',
  Establishing = 'establishing',
  ExtremeCloseUp = 'extreme_close_up',
  Full = 'full',
  Master = 'master',
  Medium = 'medium',
  MediumCloseUp = 'medium_close_up',
  MediumFull = 'medium_full',
  Wide = 'wide'
}

/** 摄影机外参、机位和朝向。 */
export type PacePillarCameraExtrinsics = {
  __typename?: 'PacePillarCameraExtrinsics';
  /** 拍摄角度。 */
  angle?: Maybe<PacePillarCameraExtrinsicsAngleEnum>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 机位位置。 */
  position?: Maybe<PacePillarCameraExtrinsicsPositionEnum>;
};


/** 摄影机外参、机位和朝向。 */
export type PacePillarCameraExtrinsicsFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarCameraExtrinsicsAngleEnum {
  Aerial = 'aerial',
  Continuous = 'continuous',
  Dutch = 'dutch',
  EyeLevel = 'eye_level',
  Ground = 'ground',
  High = 'high',
  Hip = 'hip',
  Knee = 'knee',
  Low = 'low',
  Overhead = 'overhead',
  Shoulder = 'shoulder'
}

export enum PacePillarCameraExtrinsicsPositionEnum {
  Behind = 'behind',
  Front = 'front',
  Ots = 'ots',
  Profile = 'profile',
  ThreeQuarter = 'three_quarter'
}

/** 有理数帧率(23.976=24000/1001), 禁浮点(C-C) */
export type PacePillarCameraFps = {
  __typename?: 'PacePillarCameraFps';
  /** 分母数值。 */
  denom: Scalars['Int']['output'];
  field?: Maybe<Scalars['JSON']['output']>;
  /** 分子数值。 */
  num: Scalars['Int']['output'];
};


/** 有理数帧率(23.976=24000/1001), 禁浮点(C-C) */
export type PacePillarCameraFpsFieldArgs = {
  path: Scalars['String']['input'];
};

/** 摄影机内参和镜头参数。 */
export type PacePillarCameraIntrinsics = {
  __typename?: 'PacePillarCameraIntrinsics';
  /** dormant(C-F) */
  anamorphicSqueeze?: Maybe<Scalars['Float']['output']>;
  /** 光圈描述。 */
  aperture?: Maybe<PacePillarCameraIntrinsicsApertureEnum>;
  /** F 制光圈值。 */
  apertureF?: Maybe<Scalars['Float']['output']>;
  /** 景深控制。 */
  depthOfField?: Maybe<PacePillarCameraIntrinsicsDepthOfFieldEnum>;
  /** dormant(C-B, OpenLensIO) */
  distortion?: Maybe<PacePillarCameraIntrinsicsDistortion>;
  /** dormant(C-E) */
  encoders?: Maybe<PacePillarCameraIntrinsicsEncoders>;
  /** 米, dormant(C-G) */
  entrancePupilOffset?: Maybe<Scalars['Float']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 焦距,单位毫米。 */
  focalLengthMm?: Maybe<Scalars['Float']['output']>;
  /** 对焦距离,单位米。 */
  focusDistanceM?: Maybe<Scalars['Float']['output']>;
  /** ISO 描述。 */
  iso?: Maybe<PacePillarCameraIntrinsicsIsoEnum>;
  /** ISO 数值。 */
  isoValue?: Maybe<Scalars['Int']['output']>;
  /** 镜头规格或镜头尺寸描述。 */
  lensSize?: Maybe<PacePillarCameraIntrinsicsLensSizeEnum>;
  /** [w,h] 物理片门 mm;缺省 36x24。修『焦距→视场角』歧义(C-A) */
  sensorMm?: Maybe<Array<Maybe<Scalars['Float']['output']>>>;
  /** 快门角度,单位度。 */
  shutterAngleDeg?: Maybe<Scalars['Float']['output']>;
  /** 快门速度。 */
  shutterSpeed?: Maybe<PacePillarCameraIntrinsicsShutterSpeedEnum>;
  /** T 制光圈值。 */
  tStop?: Maybe<Scalars['Float']['output']>;
};


/** 摄影机内参和镜头参数。 */
export type PacePillarCameraIntrinsicsFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarCameraIntrinsicsApertureEnum {
  Medium = 'medium',
  Narrow = 'narrow',
  Wide = 'wide'
}

export enum PacePillarCameraIntrinsicsDepthOfFieldEnum {
  Deep = 'deep',
  Rack = 'rack',
  Shallow = 'shallow',
  Soft = 'soft',
  SplitDiopter = 'split_diopter',
  TiltShift = 'tilt_shift'
}

/** dormant(C-B, OpenLensIO) */
export type PacePillarCameraIntrinsicsDistortion = {
  __typename?: 'PacePillarCameraIntrinsicsDistortion';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 过扫描比例。 */
  overscan?: Maybe<Scalars['Float']['output']>;
  /** 径向畸变参数。 */
  radial?: Maybe<Array<Maybe<Scalars['Float']['output']>>>;
  /** 切向畸变参数。 */
  tangential?: Maybe<Array<Maybe<Scalars['Float']['output']>>>;
};


/** dormant(C-B, OpenLensIO) */
export type PacePillarCameraIntrinsicsDistortionFieldArgs = {
  path: Scalars['String']['input'];
};

/** dormant(C-E) */
export type PacePillarCameraIntrinsicsEncoders = {
  __typename?: 'PacePillarCameraIntrinsicsEncoders';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 对焦编码器值。 */
  focus?: Maybe<Scalars['Float']['output']>;
  /** 光圈编码器值。 */
  iris?: Maybe<Scalars['Float']['output']>;
  /** 变焦编码器值。 */
  zoom?: Maybe<Scalars['Float']['output']>;
};


/** dormant(C-E) */
export type PacePillarCameraIntrinsicsEncodersFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarCameraIntrinsicsIsoEnum {
  High = 'high',
  Low = 'low',
  Medium = 'medium'
}

export enum PacePillarCameraIntrinsicsLensSizeEnum {
  Fisheye = 'fisheye',
  LongLens = 'long_lens',
  Medium = 'medium',
  Standard = 'standard',
  Telephoto = 'telephoto',
  Wide = 'wide'
}

export enum PacePillarCameraIntrinsicsShutterSpeedEnum {
  Fast = 'fast',
  Medium = 'medium',
  Slow = 'slow'
}

/** 运镜程序(自 PAILang camera.program 吸收转正——此前是其 studio 写入的越 schema 野字段)。与 trajectory 的关系:program 是「怎么算出轨迹」的可复现配方(真值),trajectory.camera_path 是算出来的 6-DoF 关键帧 artifact(产物);两者并存,符合「字段是真值,prompt/轨迹是产物」铁律。 */
export type PacePillarCameraProgram = {
  __typename?: 'PacePillarCameraProgram';
  field?: Maybe<Scalars['JSON']['output']>;
  /** LAMP 运动 DSL(24 token:4 段 × mx my mz yaw tilt roll);由 lamp_compile 编译为 6-DoF 轨迹帧 */
  lampDsl?: Maybe<Scalars['String']['output']>;
  /** 生成该 DSL 的自然语言运镜意图(可复现输入) */
  narrative?: Maybe<Scalars['String']['output']>;
  /** DSL 来源:rule=规则规划器 / llm=语言模型起草 / human=人工编写 */
  source?: Maybe<PacePillarCameraProgramSourceEnum>;
};


/** 运镜程序(自 PAILang camera.program 吸收转正——此前是其 studio 写入的越 schema 野字段)。与 trajectory 的关系:program 是「怎么算出轨迹」的可复现配方(真值),trajectory.camera_path 是算出来的 6-DoF 关键帧 artifact(产物);两者并存,符合「字段是真值,prompt/轨迹是产物」铁律。 */
export type PacePillarCameraProgramFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarCameraProgramSourceEnum {
  Human = 'human',
  Llm = 'llm',
  Rule = 'rule'
}

/** 摄影机运动轨迹。 */
export type PacePillarCameraTrajectory = {
  __typename?: 'PacePillarCameraTrajectory';
  /** artifact 引用:6-DoF 关键帧 JSON 路径 */
  cameraPath?: Maybe<Scalars['String']['output']>;
  /** 运动缓动方式。 */
  easing?: Maybe<PacePillarCameraTrajectoryEasingEnum>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 摄影机支撑或运动设备。 */
  gear?: Maybe<PacePillarCameraTrajectoryGearEnum>;
  /** 二维画面运动。 */
  movement2d?: Maybe<Array<Maybe<PacePillarCameraTrajectoryMovement2dItemEnum>>>;
  /** 三维空间运动。 */
  movement3d?: Maybe<Array<Maybe<PacePillarCameraTrajectoryMovement3dItemEnum>>>;
  /** dormant(C-D)。承载链:dolly→crane→head→camera 的层级变换(OTIO transforms[].id/parentId)。 */
  rigChain?: Maybe<Array<Maybe<PacePillarCameraTrajectoryRigChainItem>>>;
  /** 是否静止镜头。 */
  static?: Maybe<Scalars['Boolean']['output']>;
};


/** 摄影机运动轨迹。 */
export type PacePillarCameraTrajectoryFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarCameraTrajectoryEasingEnum {
  EaseIn = 'ease_in',
  EaseInOut = 'ease_in_out',
  EaseOut = 'ease_out',
  Linear = 'linear'
}

export enum PacePillarCameraTrajectoryGearEnum {
  Cranes = 'cranes',
  Dolly = 'dolly',
  Drones = 'drones',
  Handheld = 'handheld',
  MotionControl = 'motion_control',
  OverheadRigs = 'overhead_rigs',
  Pedestal = 'pedestal',
  Snorricam = 'snorricam',
  Stabilizer = 'stabilizer',
  Steadicam = 'steadicam',
  Tripod = 'tripod',
  VehicleMount = 'vehicle_mount'
}

export enum PacePillarCameraTrajectoryMovement2dItemEnum {
  PanLeft = 'pan_left',
  PanRight = 'pan_right',
  TiltDown = 'tilt_down',
  TiltUp = 'tilt_up',
  ZoomIn = 'zoom_in',
  ZoomOut = 'zoom_out'
}

export enum PacePillarCameraTrajectoryMovement3dItemEnum {
  Arc = 'arc',
  CameraRoll = 'camera_roll',
  Crane = 'crane',
  DollyZoom = 'dolly_zoom',
  PullOut = 'pull_out',
  PushIn = 'push_in',
  Tracking = 'tracking',
  Trucking = 'trucking'
}

/** 数组 `trajectory.rigChain[]` 的元素结构。类型为 object。 */
export type PacePillarCameraTrajectoryRigChainItem = {
  __typename?: 'PacePillarCameraTrajectoryRigChainItem';
  field?: Maybe<Scalars['JSON']['output']>;
  /** PACE 字段 `trajectory.rigChain.[].id`,用于记录ID。 */
  id: Scalars['String']['output'];
  /** 记录类型或产物类型。 */
  kind?: Maybe<PacePillarCameraTrajectoryRigChainItemKindEnum>;
  /** 父级节点 ID。 */
  parentId?: Maybe<Scalars['String']['output']>;
};


/** 数组 `trajectory.rigChain[]` 的元素结构。类型为 object。 */
export type PacePillarCameraTrajectoryRigChainItemFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarCameraTrajectoryRigChainItemKindEnum {
  Camera = 'camera',
  CraneArm = 'crane_arm',
  Dolly = 'dolly',
  Head = 'head'
}

/** PACE events pillar schema。定义动作、情绪、对白和事件节奏真值。 */
export type PacePillarEvents = {
  __typename?: 'PacePillarEvents';
  /** 动作 beat 列表。 */
  actions?: Maybe<Array<Maybe<PacePillarEventsActionsItem>>>;
  /** 高级事件语义。 */
  advanced?: Maybe<PacePillarEventsAdvanced>;
  /** 环境变化描述。 */
  changeInEnvironment?: Maybe<Scalars['String']['output']>;
  /** 对白列表。 */
  dialogues?: Maybe<Array<Maybe<PacePillarEventsDialoguesItem>>>;
  /** 情绪 beat 列表。 */
  emotions?: Maybe<Array<Maybe<PacePillarEventsEmotionsItem>>>;
  field?: Maybe<Scalars['JSON']['output']>;
};


/** PACE events pillar schema。定义动作、情绪、对白和事件节奏真值。 */
export type PacePillarEventsFieldArgs = {
  path: Scalars['String']['input'];
};

/** 数组 `actions[]` 的元素结构。类型为 object。 */
export type PacePillarEventsActionsItem = {
  __typename?: 'PacePillarEventsActionsItem';
  /** 背景元素或背景描述。 */
  background?: Maybe<Scalars['Boolean']['output']>;
  /** 节拍特征列表。 */
  beatFeatures?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 英文动作或画面描述。 */
  descriptionEn?: Maybe<Scalars['String']['output']>;
  /** 中文动作或画面描述。 */
  descriptionZh: Scalars['String']['output'];
  /** 建议持续时间,单位秒。 */
  durationHintS?: Maybe<Scalars['Float']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 前景动作或元素。 */
  foreground?: Maybe<PaceForegroundEnum>;
  /** 动作或情绪强度。 */
  intensity?: Maybe<PacePillarEventsActionsItemIntensityEnum>;
  /** 是否包含角色或物体交互。 */
  interactive?: Maybe<Scalars['String']['output']>;
  /** 是否可作为独立动作理解。 */
  standalone?: Maybe<Scalars['String']['output']>;
  /** 时间顺序和节奏信息。 */
  temporal?: Maybe<PaceTemporalEnum>;
  /** 不确定性说明。 */
  uncertainty?: Maybe<PacePillarEventsActionsItemUncertaintyEnum>;
};


/** 数组 `actions[]` 的元素结构。类型为 object。 */
export type PacePillarEventsActionsItemFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarEventsActionsItemIntensityEnum {
  Dramatic = 'dramatic',
  Medium = 'medium',
  Subtle = 'subtle'
}

export enum PacePillarEventsActionsItemUncertaintyEnum {
  Deterministic = 'deterministic',
  Mixed = 'mixed',
  Probabilistic = 'probabilistic'
}

/** 高级事件语义。 */
export type PacePillarEventsAdvanced = {
  __typename?: 'PacePillarEventsAdvanced';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 镜头四柱真值对象。 */
  pace?: Maybe<PacePillarEventsAdvancedPaceEnum>;
  /** 节奏规律性。 */
  regularity?: Maybe<PacePillarEventsAdvancedRegularityEnum>;
  /** 故事结构位置。 */
  storyStructure?: Maybe<PacePillarEventsAdvancedStoryStructureEnum>;
};


/** 高级事件语义。 */
export type PacePillarEventsAdvancedFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarEventsAdvancedPaceEnum {
  Fast = 'fast',
  Slow = 'slow'
}

export enum PacePillarEventsAdvancedRegularityEnum {
  Irregular = 'irregular',
  Regular = 'regular'
}

export enum PacePillarEventsAdvancedStoryStructureEnum {
  Climax = 'climax',
  Conflict = 'conflict',
  Foreshadowing = 'foreshadowing',
  TurningPoint = 'turning_point'
}

/** 数组 `dialogues[]` 的元素结构。类型为 object。 */
export type PacePillarEventsDialoguesItem = {
  __typename?: 'PacePillarEventsDialoguesItem';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 前景动作或元素。 */
  foreground?: Maybe<PaceForegroundEnum>;
  /** 语言代码或语言描述。 */
  language?: Maybe<Scalars['String']['output']>;
  /** 说话人引用。 */
  speaker: Scalars['String']['output'];
  /** 对白文本。 */
  text: Scalars['String']['output'];
  /** 对白表达方式。 */
  typeOfDelivery?: Maybe<PacePillarEventsDialoguesItemTypeOfDeliveryEnum>;
};


/** 数组 `dialogues[]` 的元素结构。类型为 object。 */
export type PacePillarEventsDialoguesItemFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarEventsDialoguesItemTypeOfDeliveryEnum {
  Dash = 'dash',
  Ellipsis = 'ellipsis',
  Monologue = 'monologue',
  Shouted = 'shouted',
  Whispered = 'whispered'
}

/** 数组 `emotions[]` 的元素结构。类型为 object。 */
export type PacePillarEventsEmotionsItem = {
  __typename?: 'PacePillarEventsEmotionsItem';
  /** 背景元素或背景描述。 */
  background?: Maybe<Scalars['Boolean']['output']>;
  /** 外显情绪。 */
  explicit?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 前景动作或元素。 */
  foreground?: Maybe<PaceForegroundEnum>;
  /** 隐含情绪。 */
  implicit?: Maybe<Scalars['String']['output']>;
  /** 时间顺序和节奏信息。 */
  temporal?: Maybe<PaceTemporalEnum>;
};


/** 数组 `emotions[]` 的元素结构。类型为 object。 */
export type PacePillarEventsEmotionsItemFieldArgs = {
  path: Scalars['String']['input'];
};

/** PACE lighting pillar schema。定义自然光、灯具、色温、阴影和反射等光照真值。 */
export type PacePillarLighting = {
  __typename?: 'PacePillarLighting';
  /** DEPRECATED→lights[]。逐光分主体 subject_ref 列表(Li-E, dormant) */
  affects?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** DEPRECATED→lights[]。focus_point_ref —— 灯位变几何(Li-D, dormant) */
  aim?: Maybe<Scalars['String']['output']>;
  /** DEPRECATED→lights[]。dormant(Li-B) */
  beamAngle?: Maybe<Scalars['Float']['output']>;
  /** DEPRECATED→lights[]。dormant(Li-B) */
  beamType?: Maybe<PacePillarLightingBeamTypeEnum>;
  /** DEPRECATED→lights[]。dormant(Li-G) */
  colorCie?: Maybe<Array<Maybe<Scalars['Float']['output']>>>;
  /** 色片或染色光配置。 */
  colorGels?: Maybe<Scalars['String']['output']>;
  /** 色温数值,单位 K。 */
  colorTempK?: Maybe<Scalars['Int']['output']>;
  /** 色温描述。 */
  colorTemperature?: Maybe<PacePillarLightingColorTemperatureEnum>;
  /** 光照条件。 */
  condition?: Maybe<PacePillarLightingConditionEnum>;
  /** DEPRECATED→lights[]。曝光档(dormant) */
  exposure?: Maybe<Scalars['Float']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** DEPRECATED→lights[]。dormant(Li-B) */
  fieldAngle?: Maybe<Scalars['Float']['output']>;
  /** DEPRECATED→lights[]。灯具资产引用(Li-F, dormant) */
  fixtureRef?: Maybe<Scalars['String']['output']>;
  /** 是否有硬阴影。 */
  hardShadows?: Maybe<PacePillarLightingHardShadowsEnum>;
  /** DEPRECATED→lights[]。IES 文件引用(Li-A, dormant) */
  iesProfile?: Maybe<Scalars['String']['output']>;
  /** DEPRECATED→lights[]。光通量 lm(Li-C, dormant) */
  intensityLm?: Maybe<Scalars['Float']['output']>;
  /** dormant(Phase 3)。逐灯几何/光度精确轨——多灯布光(主光+轮廓光各自 aim/intensity/affects)在此表达。定性桶字段(natural/condition/position/colorTemperature 等)仍留柱级,描述整体光环境。 */
  lights?: Maybe<Array<Maybe<PacePillarLightingLightsItem>>>;
  /** 光照运动或变化。 */
  motion?: Maybe<PacePillarLightingMotionEnum>;
  /** 自然光描述。 */
  natural?: Maybe<Array<Maybe<PacePillarLightingNaturalItemEnum>>>;
  /** 人工备注。 */
  notes?: Maybe<Scalars['String']['output']>;
  /** 机位位置。 */
  position?: Maybe<Array<Maybe<PaceLightRoleEnum>>>;
  /** 实景光源描述。 */
  practicals?: Maybe<Array<Maybe<PacePillarLightingPracticalsItemEnum>>>;
  /** 反射特征。 */
  reflection?: Maybe<Scalars['String']['output']>;
  /** 是否有柔和阴影。 */
  softShadows?: Maybe<PacePillarLightingSoftShadowsEnum>;
  /** DEPRECATED→lights[]。dormant(Li-G) */
  spectrumRef?: Maybe<Scalars['String']['output']>;
};


/** PACE lighting pillar schema。定义自然光、灯具、色温、阴影和反射等光照真值。 */
export type PacePillarLightingFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarLightingBeamTypeEnum {
  Fresnel = 'Fresnel',
  Pc = 'PC',
  Spot = 'Spot',
  Wash = 'Wash'
}

export enum PacePillarLightingColorTemperatureEnum {
  Cold = 'cold',
  Cool = 'cool',
  Warm = 'warm'
}

export enum PacePillarLightingConditionEnum {
  Candlelight = 'candlelight',
  ClearDaylight = 'clear_daylight',
  GoldenHour = 'golden_hour',
  Overcast = 'overcast',
  WhiteFluorescent = 'white_fluorescent'
}

export enum PacePillarLightingHardShadowsEnum {
  DirectLight = 'direct_light',
  LowKeyLighting = 'low_key_lighting'
}

/** 数组 `lights[]` 的元素结构。类型为 object。 */
export type PacePillarLightingLightsItem = {
  __typename?: 'PacePillarLightingLightsItem';
  /** entity_ref 列表(subject/prop 均可):这盏灯只影响哪些实体(光照解耦 Li-E) */
  affects?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** focus_point_ref:灯瞄哪个空间点(与相机/视线共瞄,Li-D) */
  aim?: Maybe<Scalars['String']['output']>;
  /** Li-B */
  beamAngle?: Maybe<Scalars['Float']['output']>;
  /** Li-B */
  beamType?: Maybe<PacePillarLightingLightsItemBeamTypeEnum>;
  /** Li-G */
  colorCie?: Maybe<Array<Maybe<Scalars['Float']['output']>>>;
  /** 色温数值,单位 K。 */
  colorTempK?: Maybe<Scalars['Int']['output']>;
  /** 曝光或光强。 */
  exposure?: Maybe<Scalars['Float']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** Li-B */
  fieldAngle?: Maybe<Scalars['Float']['output']>;
  /** 灯具资产引用(Li-F) */
  fixtureRef?: Maybe<Scalars['String']['output']>;
  /** PACE 字段 `lights.[].id`,用于记录ID。 */
  id: Scalars['String']['output'];
  /** IES 文件引用(Li-A) */
  iesProfile?: Maybe<Scalars['String']['output']>;
  /** 光通量 lm(Li-C) */
  intensityLm?: Maybe<Scalars['Float']['output']>;
  /** 灯具角色。 */
  role?: Maybe<PaceLightRoleEnum>;
  /** Li-G */
  spectrumRef?: Maybe<Scalars['String']['output']>;
};


/** 数组 `lights[]` 的元素结构。类型为 object。 */
export type PacePillarLightingLightsItemFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarLightingLightsItemBeamTypeEnum {
  Fresnel = 'Fresnel',
  Pc = 'PC',
  Spot = 'Spot',
  Wash = 'Wash'
}

export enum PacePillarLightingMotionEnum {
  Flickering = 'flickering',
  Pulsing = 'pulsing'
}

export enum PacePillarLightingNaturalItemEnum {
  Firelight = 'firelight',
  Moonlight = 'moonlight',
  Sunlight = 'sunlight'
}

export enum PacePillarLightingPracticalsItemEnum {
  Fluorescent = 'fluorescent',
  Hid = 'hid',
  Hmi = 'hmi',
  Led = 'led',
  Tungsten = 'tungsten'
}

export enum PacePillarLightingSoftShadowsEnum {
  DiffusedLight = 'diffused_light',
  HighKeyLighting = 'high_key_lighting',
  Reflectors = 'reflectors'
}

/** PACE setup pillar schema。定义主体、道具、环境、构图和材质等画面搭建真值。 */
export type PacePillarSetup = {
  __typename?: 'PacePillarSetup';
  /** 背景和场景设定。 */
  backdrop?: Maybe<PacePillarSetupBackdrop>;
  /** 环境氛围和空间属性。 */
  environment?: Maybe<PacePillarSetupEnvironment>;
  /** 需要排除的元素或效果。 */
  excluded?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 画面几何和构图关系。 */
  geometry?: Maybe<PacePillarSetupGeometry>;
  /** dormant(B-C, MaterialX OpenPBR) */
  materialAdvanced?: Maybe<PacePillarSetupMaterialAdvanced>;
  /** shot 级真值;panel.primaryFocus 只是 override——仅当该 panel 焦点与 shot 不同时才写(稀疏覆盖链:缺失不覆盖) */
  primaryFocus?: Maybe<PacePillarSetupPrimaryFocus>;
  /** 道具列表。 */
  props?: Maybe<Array<Maybe<PaceProp>>>;
  /** 次要主体列表。 */
  secondarySubjects?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 空间深度和空间组织。 */
  space?: Maybe<PacePillarSetupSpace>;
  /** 画面主体列表。 */
  subjects?: Maybe<Array<Maybe<PaceSubject>>>;
  /** 画面文字生成约束。 */
  textGeneration?: Maybe<Array<Maybe<PaceTextElement>>>;
  /** 纹理和影像质感。 */
  texture?: Maybe<PacePillarSetupTexture>;
};


/** PACE setup pillar schema。定义主体、道具、环境、构图和材质等画面搭建真值。 */
export type PacePillarSetupFieldArgs = {
  path: Scalars['String']['input'];
};

/** 背景和场景设定。 */
export type PacePillarSetupBackdrop = {
  __typename?: 'PacePillarSetupBackdrop';
  /** 文化背景。 */
  culture?: Maybe<Scalars['String']['output']>;
  /** 时代背景。 */
  era?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 对齐 entities/locations.json 台账 ref */
  location?: Maybe<Scalars['String']['output']>;
  /** 地域背景。 */
  region?: Maybe<Scalars['String']['output']>;
  /** 季节。 */
  season?: Maybe<Scalars['String']['output']>;
  /** 场景设置或空间类型。 */
  setting?: Maybe<PacePillarSetupBackdropSettingEnum>;
  /** 故事时间段。 */
  timeOfDay?: Maybe<PacePillarSetupBackdropTimeOfDayEnum>;
  /** 天气。 */
  weather?: Maybe<Scalars['String']['output']>;
};


/** 背景和场景设定。 */
export type PacePillarSetupBackdropFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarSetupBackdropSettingEnum {
  Ext = 'ext',
  Int = 'int'
}

export enum PacePillarSetupBackdropTimeOfDayEnum {
  Afternoon = 'afternoon',
  Dawn = 'dawn',
  Day = 'day',
  Dusk = 'dusk',
  Evening = 'evening',
  LateNight = 'late_night',
  Midday = 'midday',
  Morning = 'morning',
  Night = 'night',
  Sunrise = 'sunrise',
  Sunset = 'sunset'
}

/** 环境氛围和空间属性。 */
export type PacePillarSetupEnvironment = {
  __typename?: 'PacePillarSetupEnvironment';
  /** 背景元素或背景描述。 */
  background?: Maybe<Scalars['String']['output']>;
  /** 画面元素密度。 */
  density?: Maybe<PacePillarSetupEnvironmentDensityEnum>;
  /** 环境元素列表。 */
  elements?: Maybe<Array<Maybe<PacePillarSetupEnvironmentElementsItemEnum>>>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 整体情绪氛围。 */
  mood?: Maybe<Scalars['String']['output']>;
  /** 负空间使用。 */
  negativeSpace?: Maybe<Scalars['Boolean']['output']>;
  /** 空间或对象尺度。 */
  scale?: Maybe<Scalars['String']['output']>;
  /** 视觉风格。 */
  style?: Maybe<PacePillarSetupEnvironmentStyleEnum>;
};


/** 环境氛围和空间属性。 */
export type PacePillarSetupEnvironmentFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarSetupEnvironmentDensityEnum {
  Clean = 'clean',
  Cluttered = 'cluttered'
}

export enum PacePillarSetupEnvironmentElementsItemEnum {
  Ash = 'ash',
  Dust = 'dust',
  Fire = 'fire',
  Fog = 'fog',
  Rain = 'rain',
  Smoke = 'smoke',
  Snow = 'snow',
  Thunder = 'thunder',
  Wind = 'wind'
}

export enum PacePillarSetupEnvironmentStyleEnum {
  Chiaroscuro = 'chiaroscuro',
  ConceptArt = 'concept_art',
  InkColor = 'ink_color',
  InkwashBw = 'inkwash_bw',
  LineArtClean = 'line_art_clean',
  Photoreal = 'photoreal',
  SketchBw = 'sketch_bw'
}

/** 画面几何和构图关系。 */
export type PacePillarSetupGeometry = {
  __typename?: 'PacePillarSetupGeometry';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 画面平衡。 */
  frameBalance?: Maybe<PacePillarSetupGeometryFrameBalanceEnum>;
  /** 线条特征。 */
  lines?: Maybe<PacePillarSetupGeometryLinesEnum>;
  /** 自然形状。 */
  naturalShapes?: Maybe<PacePillarSetupGeometryNaturalShapesEnum>;
  /** 位置准确性要求。 */
  positionalAccuracy?: Maybe<Scalars['String']['output']>;
  /** 规则形状。 */
  regularShapes?: Maybe<PacePillarSetupGeometryRegularShapesEnum>;
  /** 相对位置关系。 */
  relativePositioning?: Maybe<Scalars['String']['output']>;
};


/** 画面几何和构图关系。 */
export type PacePillarSetupGeometryFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarSetupGeometryFrameBalanceEnum {
  LeftHeavy = 'left_heavy',
  RightHeavy = 'right_heavy',
  RuleOfThirds = 'rule_of_thirds',
  Symmetry = 'symmetry'
}

export enum PacePillarSetupGeometryLinesEnum {
  Diagonal = 'diagonal',
  Horizontal = 'horizontal',
  Vertical = 'vertical'
}

export enum PacePillarSetupGeometryNaturalShapesEnum {
  CloudLike = 'cloud_like',
  WaterLike = 'water_like'
}

export enum PacePillarSetupGeometryRegularShapesEnum {
  Circle = 'circle',
  Square = 'square',
  Triangle = 'triangle'
}

/** dormant(B-C, MaterialX OpenPBR) */
export type PacePillarSetupMaterialAdvanced = {
  __typename?: 'PacePillarSetupMaterialAdvanced';
  /** 涂层材质参数。 */
  coat?: Maybe<Scalars['JSON']['output']>;
  /** 自发光材质参数。 */
  emission?: Maybe<Scalars['JSON']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 次表面散射参数。 */
  subsurface?: Maybe<Scalars['JSON']['output']>;
  /** 薄膜干涉材质参数。 */
  thinFilm?: Maybe<Scalars['JSON']['output']>;
};


/** dormant(B-C, MaterialX OpenPBR) */
export type PacePillarSetupMaterialAdvancedFieldArgs = {
  path: Scalars['String']['input'];
};

/** shot 级真值;panel.primaryFocus 只是 override——仅当该 panel 焦点与 shot 不同时才写(稀疏覆盖链:缺失不覆盖) */
export type PacePillarSetupPrimaryFocus = {
  __typename?: 'PacePillarSetupPrimaryFocus';
  /** 画面覆盖比例,0 到 100。 */
  coveragePct?: Maybe<Scalars['Int']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** type=feature 时必填。角色资产 ID,可追加 @version。 */
  ofCharacter?: Maybe<Scalars['String']['output']>;
  /** 实体或资产引用。 */
  ref: Scalars['String']['output'];
  /** 对象类型。 */
  type: PacePillarSetupPrimaryFocusTypeEnum;
};


/** shot 级真值;panel.primaryFocus 只是 override——仅当该 panel 焦点与 shot 不同时才写(稀疏覆盖链:缺失不覆盖) */
export type PacePillarSetupPrimaryFocusFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarSetupPrimaryFocusTypeEnum {
  Character = 'character',
  Environment = 'environment',
  Feature = 'feature',
  Object = 'object'
}

/** 空间深度和空间组织。 */
export type PacePillarSetupSpace = {
  __typename?: 'PacePillarSetupSpace';
  /** 空间深度。 */
  depth?: Maybe<PacePillarSetupSpaceDepthEnum>;
  field?: Maybe<Scalars['JSON']['output']>;
};


/** 空间深度和空间组织。 */
export type PacePillarSetupSpaceFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarSetupSpaceDepthEnum {
  Ambiguous = 'ambiguous',
  Deep = 'deep',
  Flat = 'flat',
  Limited = 'limited'
}

/** 纹理和影像质感。 */
export type PacePillarSetupTexture = {
  __typename?: 'PacePillarSetupTexture';
  /** 模糊程度。 */
  blur?: Maybe<PacePillarSetupTextureBlurEnum>;
  /** 色彩 palette。 */
  colorPalette?: Maybe<Scalars['String']['output']>;
  /** 对比度。 */
  contrast?: Maybe<PacePillarSetupTextureContrastEnum>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 胶片颗粒。 */
  filmGrain?: Maybe<Scalars['Boolean']['output']>;
  /** 噪声程度。 */
  noise?: Maybe<PacePillarSetupTextureNoiseEnum>;
};


/** 纹理和影像质感。 */
export type PacePillarSetupTextureFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePillarSetupTextureBlurEnum {
  Gaussian = 'gaussian',
  Motion = 'motion',
  Radial = 'radial'
}

export enum PacePillarSetupTextureContrastEnum {
  High = 'high',
  Low = 'low'
}

export enum PacePillarSetupTextureNoiseEnum {
  Gaussian = 'gaussian',
  Poisson = 'poisson',
  SaltAndPepper = 'salt_and_pepper'
}

/** 文件:<projectId>/manifest.json。项目级 manifest,保存项目元数据、流程状态和项目级 artifacts[]。 */
export type PaceProjectManifest = {
  __typename?: 'PaceProjectManifest';
  /** 项目级产物索引(append-only),如源剧本文本、全项目故事板 PDF/HTML。 */
  artifacts?: Maybe<Array<Maybe<PaceArtifactItem>>>;
  /** 记录创建时间,使用 ISO 8601 字符串。 */
  createdAt?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 项目标识或项目目录名。 */
  project: Scalars['String']['output'];
  /** 项目 ID,应与项目目录名一致。 */
  projectId: Scalars['String']['output'];
  /** PACE schema 版本号。 */
  schemaVersion?: Maybe<Scalars['String']['output']>;
  /** 拆剧本流程状态和输入来源元数据。 */
  scriptSplit?: Maybe<PaceProjectManifestScriptSplit>;
  /** Selected project visual style id. */
  styleId?: Maybe<Scalars['String']['output']>;
  /** 项目标题。 */
  title: Scalars['String']['output'];
  /** 记录最后更新时间,使用 ISO 8601 字符串。 */
  updatedAt?: Maybe<Scalars['String']['output']>;
  /** 项目级流程状态。 */
  workflowState?: Maybe<PaceProjectManifestWorkflowState>;
};


/** 文件:<projectId>/manifest.json。项目级 manifest,保存项目元数据、流程状态和项目级 artifacts[]。 */
export type PaceProjectManifestFieldArgs = {
  path: Scalars['String']['input'];
};

/** 拆剧本流程状态和输入来源元数据。 */
export type PaceProjectManifestScriptSplit = {
  __typename?: 'PaceProjectManifestScriptSplit';
  /** 任务完成时间,使用 ISO 8601 字符串。 */
  completedAt?: Maybe<Scalars['String']['output']>;
  /** 失败时记录错误摘要。 */
  error?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 平台 job ID。 */
  jobId?: Maybe<Scalars['String']['output']>;
  /** 执行拆剧本/结构化任务所用模型或 worker 模型标识;承接旧 scenesBreakdown._meta.modelUsed。 */
  modelUsed?: Maybe<Scalars['String']['output']>;
  /** 拆剧本输入剧本的展示名/文件名;承接旧 scenesBreakdown._meta.sourceScript,不作为工程内路径真值。 */
  sourceScript?: Maybe<Scalars['String']['output']>;
  /** 拆剧本输入剧本的 assets:// URI;剧本文本/PDF/HTML 原件作为项目级 artifact 登记。 */
  sourceScriptUri?: Maybe<Scalars['String']['output']>;
  /** 当前状态。 */
  status?: Maybe<Scalars['String']['output']>;
  /** 任务提交时间,使用 ISO 8601 字符串。 */
  submittedAt?: Maybe<Scalars['String']['output']>;
  /** worker task 类型。 */
  taskType?: Maybe<Scalars['String']['output']>;
  /** 记录最后更新时间,使用 ISO 8601 字符串。 */
  updatedAt?: Maybe<Scalars['String']['output']>;
  /** 执行该任务的 worker 名称。 */
  workerName?: Maybe<Scalars['String']['output']>;
};


/** 拆剧本流程状态和输入来源元数据。 */
export type PaceProjectManifestScriptSplitFieldArgs = {
  path: Scalars['String']['input'];
};

/** 项目级流程状态。 */
export type PaceProjectManifestWorkflowState = {
  __typename?: 'PaceProjectManifestWorkflowState';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 项目最终确认状态。 */
  finalConfirmed?: Maybe<Scalars['Boolean']['output']>;
  /** 各流程阶段的状态表。 */
  phaseStatuses?: Maybe<Scalars['JSON']['output']>;
  /** 记录最后更新时间,使用 ISO 8601 字符串。 */
  updatedAt?: Maybe<Scalars['String']['output']>;
};


/** 项目级流程状态。 */
export type PaceProjectManifestWorkflowStateFieldArgs = {
  path: Scalars['String']['input'];
};

/** 复用结构 `prop`,用于 `pillar.setup.schema.json` 中的嵌套对象。 */
export type PaceProp = {
  __typename?: 'PaceProp';
  /** 分类标签。 */
  cls?: Maybe<Scalars['String']['output']>;
  /** 颜色。 */
  color?: Maybe<Scalars['String']['output']>;
  /** 数量。 */
  count?: Maybe<Scalars['Int']['output']>;
  /** 文本说明。 */
  description?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 角色资产 ID 引用,可追加 @version。 */
  heldBy?: Maybe<Scalars['String']['output']>;
  /** 材质。 */
  material?: Maybe<PacePropMaterialEnum>;
  /** 图案。 */
  pattern?: Maybe<PacePropPatternEnum>;
  /** 道具 ID。 */
  propId?: Maybe<Scalars['String']['output']>;
  /** 画面中的屏幕位置。 */
  screenPosition?: Maybe<PaceScreenPosition>;
  /** 尺寸。 */
  size?: Maybe<PacePropSizeEnum>;
  /** 状态。 */
  state?: Maybe<PacePropStateEnum>;
  /** 用途。 */
  utility?: Maybe<PacePropUtilityEnum>;
};


/** 复用结构 `prop`,用于 `pillar.setup.schema.json` 中的嵌套对象。 */
export type PacePropFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PacePropMaterialEnum {
  Ceramic = 'ceramic',
  Fabric = 'fabric',
  Glass = 'glass',
  Leather = 'leather',
  Metal = 'metal',
  Paper = 'paper',
  Plastic = 'plastic',
  Stone = 'stone',
  Wood = 'wood'
}

export enum PacePropPatternEnum {
  Bricks = 'bricks',
  Checker = 'checker',
  Dots = 'dots',
  Grid = 'grid',
  Hexagons = 'hexagons',
  Metal = 'metal',
  Stripes = 'stripes',
  Zigzag = 'zigzag'
}

export enum PacePropSizeEnum {
  HumanScale = 'human_scale',
  Miniature = 'miniature',
  Monumental = 'monumental',
  PalmSized = 'palm_sized',
  TwoPerson = 'two_person',
  Wearable = 'wearable'
}

export enum PacePropStateEnum {
  Bloodied = 'bloodied',
  Broken = 'broken',
  Burning = 'burning',
  Dusty = 'dusty',
  Frozen = 'frozen',
  Polished = 'polished',
  Pristine = 'pristine',
  Rusted = 'rusted',
  Weathered = 'weathered',
  Wet = 'wet'
}

export enum PacePropUtilityEnum {
  Decorative = 'decorative',
  Functional = 'functional'
}

/** 文件:scenes/<sceneId>/manifest.json。场景级 manifest,保存叙事元数据、shot 默认值和场景级 artifacts[]。空间布局 physicalLayout 已下放到 shot manifest(逐镜 blocking)。 */
export type PaceSceneManifest = {
  __typename?: 'PaceSceneManifest';
  /** 剧作幕或段落标识。 */
  act?: Maybe<Scalars['String']['output']>;
  /** 场景级产物索引(append-only 数组:同 kind 多条 = 多 take/多上传版本,永不覆盖) */
  artifacts?: Maybe<Array<Maybe<PaceArtifactItem>>>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 记录生成时间,使用 ISO 8601 字符串。 */
  generatedAt?: Maybe<Scalars['String']['output']>;
  /** 场景级叙事元数据。 */
  narrativeMeta?: Maybe<PaceSceneManifestNarrativeMeta>;
  /** 场景标题或场景头。 */
  sceneHeading?: Maybe<Scalars['String']['output']>;
  /** 场景 ID,格式如 s001。 */
  sceneId: Scalars['String']['output'];
  /** 场景序号,从 1 开始。 */
  sceneNumber: Scalars['Int']['output'];
  /** PACE schema 版本号。 */
  schemaVersion: Scalars['String']['output'];
  /** 语义和版本上下文。 */
  semantics?: Maybe<PaceSemantics>;
  /** 场级共享字段(稀疏);合并语义:None 永不覆盖有值 */
  shotDefaults?: Maybe<PaceSceneManifestShotDefaults>;
  /** 字段或记录来源。 */
  source?: Maybe<Scalars['String']['output']>;
};


/** 文件:scenes/<sceneId>/manifest.json。场景级 manifest,保存叙事元数据、shot 默认值和场景级 artifacts[]。空间布局 physicalLayout 已下放到 shot manifest(逐镜 blocking)。 */
export type PaceSceneManifestFieldArgs = {
  path: Scalars['String']['input'];
};

/** 场景级叙事元数据。 */
export type PaceSceneManifestNarrativeMeta = {
  __typename?: 'PaceSceneManifestNarrativeMeta';
  /** 角色在本场的年龄或阶段状态表。 */
  characterAgeStates?: Maybe<Scalars['JSON']['output']>;
  /** 本场出现的角色 ID 列表。 */
  charactersPresent?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 拆剧本阶段推断的镜头数量。 */
  impliedShotCount?: Maybe<Scalars['Int']['output']>;
  /** 内景/外景标记。 */
  interiorExterior?: Maybe<PaceSceneManifestNarrativeMetaInteriorExteriorEnum>;
  /** 本场关键动作摘要列表。 */
  keyActions?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 剧本原文中的地点描述。 */
  locationRaw?: Maybe<Scalars['String']['output']>;
  /** 标准化地点实体引用。 */
  locationRef?: Maybe<Scalars['String']['output']>;
  /** 画面内对白列表。 */
  onScreenDialogue?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
  /** 音效备注列表。 */
  sfxNotes?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 叙事节拍或剧情节点。 */
  storyBeat?: Maybe<Scalars['String']['output']>;
  /** 内容摘要。 */
  summary?: Maybe<Scalars['String']['output']>;
  /** 故事时间段。 */
  timeOfDay?: Maybe<Scalars['String']['output']>;
  /** 旁白或画外音台词列表。 */
  voLines?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
};


/** 场景级叙事元数据。 */
export type PaceSceneManifestNarrativeMetaFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceSceneManifestNarrativeMetaInteriorExteriorEnum {
  Ext = 'EXT',
  Int = 'INT'
}

/** 场级共享字段(稀疏);合并语义:None 永不覆盖有值 */
export type PaceSceneManifestShotDefaults = {
  __typename?: 'PaceSceneManifestShotDefaults';
  /** 摄影机四柱。 */
  camera?: Maybe<PacePillarCamera>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 光照四柱。 */
  lighting?: Maybe<PacePillarLighting>;
  /** 画面搭建四柱。 */
  setup?: Maybe<PacePillarSetup>;
};


/** 场级共享字段(稀疏);合并语义:None 永不覆盖有值 */
export type PaceSceneManifestShotDefaultsFieldArgs = {
  path: Scalars['String']['input'];
};

/** 有 physicalLayout 时由相机投影派生,手填仅作回退 */
export type PaceScreenPosition = {
  __typename?: 'PaceScreenPosition';
  /** 空间深度。 */
  depth?: Maybe<PaceScreenPositionDepthEnum>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 屏幕水平位置。 */
  x?: Maybe<Scalars['Float']['output']>;
  /** 屏幕垂直位置。 */
  y?: Maybe<Scalars['Float']['output']>;
  /** 三分法 13 区(自 PAILang ScreenZone 吸收,3×3 + 边带语义齐全;原 9 区的 top/bottom 改名 upper/lower,值迁移见 10 §B2) */
  zone?: Maybe<PaceScreenPositionZoneEnum>;
};


/** 有 physicalLayout 时由相机投影派生,手填仅作回退 */
export type PaceScreenPositionFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceScreenPositionDepthEnum {
  Background = 'background',
  Foreground = 'foreground',
  Midground = 'midground'
}

export enum PaceScreenPositionZoneEnum {
  Center = 'center',
  CenterLeft = 'center_left',
  CenterRight = 'center_right',
  Left = 'left',
  Lower = 'lower',
  LowerCenter = 'lower_center',
  LowerLeft = 'lower_left',
  LowerRight = 'lower_right',
  Right = 'right',
  Upper = 'upper',
  UpperCenter = 'upper_center',
  UpperLeft = 'upper_left',
  UpperRight = 'upper_right'
}

/** PACE semantics schema。定义语义版本、生产上下文、叙事上下文和实体关系。 */
export type PaceSemantics = {
  __typename?: 'PaceSemantics';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 故事世界 */
  narrativeContext?: Maybe<PaceSemanticsNarrativeContext>;
  /** 制作物流(与叙事语境分离) */
  productionContext?: Maybe<PaceSemanticsProductionContext>;
  /** 实体关系列表。 */
  relationships?: Maybe<Array<Maybe<PaceSemanticsRelationshipsItem>>>;
  /** 任务信息。 */
  task?: Maybe<PaceSemanticsTask>;
  /** take 血缘(OMC Version) */
  version?: Maybe<PaceSemanticsVersion>;
};


/** PACE semantics schema。定义语义版本、生产上下文、叙事上下文和实体关系。 */
export type PaceSemanticsFieldArgs = {
  path: Scalars['String']['input'];
};

/** 故事世界 */
export type PaceSemanticsNarrativeContext = {
  __typename?: 'PaceSemanticsNarrativeContext';
  /** 时代背景。 */
  era?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** PACE 字段 `narrativeContext.location`,用于记录地点。 */
  location?: Maybe<Scalars['String']['output']>;
  /** PACE 字段 `narrativeContext.time`,用于记录时间。 */
  time?: Maybe<Scalars['String']['output']>;
};


/** 故事世界 */
export type PaceSemanticsNarrativeContextFieldArgs = {
  path: Scalars['String']['input'];
};

/** 制作物流(与叙事语境分离) */
export type PaceSemanticsProductionContext = {
  __typename?: 'PaceSemanticsProductionContext';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 模型或工作流标识。 */
  model?: Maybe<Scalars['String']['output']>;
  /** 渲染节点标识。 */
  renderNode?: Maybe<Scalars['String']['output']>;
  /** 拍摄日或制作日。 */
  shootDay?: Maybe<Scalars['String']['output']>;
};


/** 制作物流(与叙事语境分离) */
export type PaceSemanticsProductionContextFieldArgs = {
  path: Scalars['String']['input'];
};

/** 数组 `relationships[]` 的元素结构。类型为 object。 */
export type PaceSemanticsRelationshipsItem = {
  __typename?: 'PaceSemanticsRelationshipsItem';
  field?: Maybe<Scalars['JSON']['output']>;
  /** 关系客体。 */
  object: Scalars['String']['output'];
  /** heldBy / gazeAt / appearsIn / … */
  rel: Scalars['String']['output'];
  /** 关系主体。 */
  subject: Scalars['String']['output'];
};


/** 数组 `relationships[]` 的元素结构。类型为 object。 */
export type PaceSemanticsRelationshipsItemFieldArgs = {
  path: Scalars['String']['input'];
};

/** 任务信息。 */
export type PaceSemanticsTask = {
  __typename?: 'PaceSemanticsTask';
  field?: Maybe<Scalars['JSON']['output']>;
  /** PACE 字段 `task.id`,用于记录ID。 */
  id?: Maybe<Scalars['String']['output']>;
  /** L0–L5 或 S1–S3 */
  layer?: Maybe<Scalars['String']['output']>;
  /** 人或模型(模型也是 Participant) */
  participant?: Maybe<Scalars['String']['output']>;
};


/** 任务信息。 */
export type PaceSemanticsTaskFieldArgs = {
  path: Scalars['String']['input'];
};

/** take 血缘(OMC Version) */
export type PaceSemanticsVersion = {
  __typename?: 'PaceSemanticsVersion';
  /** 派生来源版本或记录。 */
  derivedFrom?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** PACE 字段 `version.id`,用于记录ID。 */
  id: Scalars['String']['output'];
  /** 当前状态。 */
  status: PaceSemanticsVersionStatusEnum;
};


/** take 血缘(OMC Version) */
export type PaceSemanticsVersionFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceSemanticsVersionStatusEnum {
  Approved = 'approved',
  Draft = 'draft',
  Rejected = 'rejected'
}

/** 文件:scenes/<sceneId>/shots/<shotId>/manifest.json。镜头级 manifest,保存四柱真值 pace、空间布局 physicalLayout(逐镜 blocking)、语义、连续性、prompt 编译缓存、shot 级 artifacts[] 和审核状态。 */
export type PaceShotManifest = {
  __typename?: 'PaceShotManifest';
  /** 产物索引(append-only 数组:同 kind 多条 = 多 take,永不覆盖;选用哪条由 version.status / review 决定) */
  artifacts?: Maybe<Array<Maybe<PaceArtifactItem>>>;
  /** 镜头使用的资产引用列表。 */
  assets?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 镜头音频管线参数。 */
  audio?: Maybe<PaceShotManifestAudio>;
  /** 角色资产 ID 列表,每项可追加 @version。 */
  characters?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 人工 prompt 覆盖(最高优先;authoredBy/authoredAt 必填于覆盖体内) */
  compileHints?: Maybe<Array<Maybe<PaceShotManifestCompileHintsItem>>>;
  /** 镜头连续性信息。 */
  continuity?: Maybe<PaceShotManifestContinuity>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 字段来源追踪列表;每条用 path 指向字段,不使用动态 key。 */
  fieldMeta?: Maybe<Array<Maybe<PaceShotManifestFieldMetaItem>>>;
  /** 拆剧本阶段生成的四柱冻结快照。worker 重跑拆分、PAILang 编译或 carried narrative 时以该快照作为干净种子,避免读取已被 agent/人工改写过的 pace 后产生逐次漂移。旧临时字段 split_pace/splitPace 迁移到本字段;真值仍以 pace 为当前可编辑版本。 */
  frozenSplit?: Maybe<PaceShotManifestFrozenSplit>;
  /** 镜头叙事意图。 */
  narrativeIntent?: Maybe<Scalars['String']['output']>;
  /** dormant(Phase 3)。非破坏几何覆盖层。分流规则:结构性意图变化(换道具/改布局类型)→ 改 PACE 字段重生成基础层;blocking 微调(挪位置/转角度)→ 写入覆盖层;重生成基础层时覆盖层不被覆盖、经 USD 合成重新生效。 */
  overrides?: Maybe<PaceShotManifestOverrides>;
  /** 镜头四柱真值对象。 */
  pace: PaceShotManifestPace;
  /** shot 级世界坐标 blocking(dormant→Phase 3;S2 可写粗 blocking)。一次场景推理、逐镜落盘:同一实体跨镜默认同坐标,人工可逐镜 override(field_meta per-field 保护)。 */
  physicalLayout?: Maybe<PaceShotManifestPhysicalLayout>;
  /** 项目 ID,应与项目目录名一致。 */
  projectId: Scalars['String']['output'];
  /** 编译产物缓存列表;每条用 id 标识,真值在 pace 字段。 */
  prompts?: Maybe<Array<Maybe<PaceShotManifestPromptsItem>>>;
  /** dormant(Phase 3)。渲染产出规格(下游 ComfyUI 工作流按它读取);primId = 渲染器逐像素对象 ID 图,替代手工 mask。 */
  renderOutputs?: Maybe<PaceShotManifestRenderOutputs>;
  /** 人工或自动审核状态。 */
  review: PaceShotManifestReview;
  /** 场景 ID,格式如 s001。 */
  sceneId: Scalars['String']['output'];
  /** PACE schema 版本号。 */
  schemaVersion: Scalars['String']['output'];
  /** 语义和版本上下文。 */
  semantics: PaceSemantics;
  /** 镜头 ID,格式如 hs001_sh001。 */
  shotId: Scalars['String']['output'];
  /** 该镜头对应的源剧本文本范围。 */
  sourceScriptRange?: Maybe<Scalars['String']['output']>;
};


/** 文件:scenes/<sceneId>/shots/<shotId>/manifest.json。镜头级 manifest,保存四柱真值 pace、空间布局 physicalLayout(逐镜 blocking)、语义、连续性、prompt 编译缓存、shot 级 artifacts[] 和审核状态。 */
export type PaceShotManifestFieldArgs = {
  path: Scalars['String']['input'];
};

/** 镜头音频管线参数。 */
export type PaceShotManifestAudio = {
  __typename?: 'PaceShotManifestAudio';
  /** 音频为二进制 → assets:// URI */
  audioTrack?: Maybe<Scalars['String']['output']>;
  /** 引用 pace.events.dialogues[] 的下标;对白文本真值在那边(单一真值),audio 只存音频管线参数 */
  dialogueRefs?: Maybe<Array<Maybe<Scalars['Int']['output']>>>;
  /** 持续时长,单位秒。 */
  durationS?: Maybe<Scalars['Float']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 口型同步配置。 */
  lipsync?: Maybe<Scalars['String']['output']>;
  /** TTS 引擎标识。 */
  ttsEngine?: Maybe<Scalars['String']['output']>;
  /** 语音或音色 ID。 */
  voiceId?: Maybe<Scalars['String']['output']>;
};


/** 镜头音频管线参数。 */
export type PaceShotManifestAudioFieldArgs = {
  path: Scalars['String']['input'];
};

/** 数组 `compileHints[]` 的元素结构。类型为 object。 */
export type PaceShotManifestCompileHintsItem = {
  __typename?: 'PaceShotManifestCompileHintsItem';
  field?: Maybe<Scalars['JSON']['output']>;
  /** Flux 工作流提示或参数。 */
  flux?: Maybe<Scalars['JSON']['output']>;
  /** GPT Image 相关提示或参数。 */
  gptImage2?: Maybe<Scalars['JSON']['output']>;
  /** 关键帧 ID,格式如 ps001_sh001_p0001。 */
  panelId: Scalars['String']['output'];
  /** WAN I2V 相关提示或参数。 */
  wanI2v?: Maybe<Scalars['JSON']['output']>;
};


/** 数组 `compileHints[]` 的元素结构。类型为 object。 */
export type PaceShotManifestCompileHintsItemFieldArgs = {
  path: Scalars['String']['input'];
};

/** 镜头连续性信息。 */
export type PaceShotManifestContinuity = {
  __typename?: 'PaceShotManifestContinuity';
  /** 服装连续性。 */
  costumeContinuity?: Maybe<Scalars['String']['output']>;
  /** 视线连续性。 */
  eyeline?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 光线方向连续性。 */
  lightDirection?: Maybe<Scalars['String']['output']>;
  /** 后一个镜头 ID。 */
  nextShotId?: Maybe<Scalars['String']['output']>;
  /** 前一个镜头 ID。 */
  previousShotId?: Maybe<Scalars['String']['output']>;
  /** 道具状态连续性。 */
  propState?: Maybe<Scalars['String']['output']>;
  /** 银幕方向连续性。 */
  screenDirection?: Maybe<Scalars['String']['output']>;
  /** 时间连续性。 */
  timeContinuity?: Maybe<Scalars['String']['output']>;
};


/** 镜头连续性信息。 */
export type PaceShotManifestContinuityFieldArgs = {
  path: Scalars['String']['input'];
};

/** 字段来源追踪条目。 */
export type PaceShotManifestFieldMetaItem = {
  __typename?: 'PaceShotManifestFieldMetaItem';
  /** 置信度,范围 0 到 1。 */
  confidence?: Maybe<Scalars['Float']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 是否已由人工确认。 */
  humanConfirmed?: Maybe<Scalars['Boolean']['output']>;
  /** 字段 JSON Pointer 路径,如 /pace/camera/intrinsics/focalLengthMm。 */
  path: Scalars['String']['output'];
  /** 字段取值理由或推断依据。 */
  rationale?: Maybe<Scalars['String']['output']>;
  /** asset_library=从资产台账带入;industrial_capture=从 OpenTrackIO/实拍数据摄取;tool_generated=系统派生(投影/反推),自动重算可覆盖(区别于人改神圣) */
  source: PaceShotManifestFieldMetaItemSourceEnum;
};


/** 字段来源追踪条目。 */
export type PaceShotManifestFieldMetaItemFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceShotManifestFieldMetaItemSourceEnum {
  AssetLibrary = 'asset_library',
  Human = 'human',
  IndustrialCapture = 'industrial_capture',
  LlmInferred = 'llm_inferred',
  LlmThenHuman = 'llm_then_human',
  Overridden = 'overridden',
  Script = 'script',
  ToolGenerated = 'tool_generated'
}

/** 拆剧本阶段生成的四柱冻结快照。worker 重跑拆分、PAILang 编译或 carried narrative 时以该快照作为干净种子,避免读取已被 agent/人工改写过的 pace 后产生逐次漂移。旧临时字段 split_pace/splitPace 迁移到本字段;真值仍以 pace 为当前可编辑版本。 */
export type PaceShotManifestFrozenSplit = {
  __typename?: 'PaceShotManifestFrozenSplit';
  /** 摄影机四柱。 */
  camera?: Maybe<PacePillarCamera>;
  /** 事件四柱。 */
  events?: Maybe<PacePillarEvents>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 光照四柱。 */
  lighting?: Maybe<PacePillarLighting>;
  /** 画面搭建四柱。 */
  setup?: Maybe<PacePillarSetup>;
};


/** 拆剧本阶段生成的四柱冻结快照。worker 重跑拆分、PAILang 编译或 carried narrative 时以该快照作为干净种子,避免读取已被 agent/人工改写过的 pace 后产生逐次漂移。旧临时字段 split_pace/splitPace 迁移到本字段;真值仍以 pace 为当前可编辑版本。 */
export type PaceShotManifestFrozenSplitFieldArgs = {
  path: Scalars['String']['input'];
};

/** dormant(Phase 3)。非破坏几何覆盖层。分流规则:结构性意图变化(换道具/改布局类型)→ 改 PACE 字段重生成基础层;blocking 微调(挪位置/转角度)→ 写入覆盖层;重生成基础层时覆盖层不被覆盖、经 USD 合成重新生效。 */
export type PaceShotManifestOverrides = {
  __typename?: 'PaceShotManifestOverrides';
  /** 覆盖或提示词作者。 */
  authoredBy?: Maybe<Scalars['String']['output']>;
  /** Blender 增量文件列表。 */
  blenderDeltaFiles?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 产生覆盖的原因。 */
  overrideReason?: Maybe<Scalars['String']['output']>;
  /** USD over 覆盖层文件路径列表(入库用 USDA 文本格式,便于 git diff) */
  usdOverLayers?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
};


/** dormant(Phase 3)。非破坏几何覆盖层。分流规则:结构性意图变化(换道具/改布局类型)→ 改 PACE 字段重生成基础层;blocking 微调(挪位置/转角度)→ 写入覆盖层;重生成基础层时覆盖层不被覆盖、经 USD 合成重新生效。 */
export type PaceShotManifestOverridesFieldArgs = {
  path: Scalars['String']['input'];
};

/** 镜头四柱真值对象。 */
export type PaceShotManifestPace = {
  __typename?: 'PaceShotManifestPace';
  /** 摄影机四柱。 */
  camera?: Maybe<PacePillarCamera>;
  /** 事件四柱。 */
  events?: Maybe<PacePillarEvents>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 光照四柱。 */
  lighting?: Maybe<PacePillarLighting>;
  /** 画面搭建四柱。 */
  setup?: Maybe<PacePillarSetup>;
};


/** 镜头四柱真值对象。 */
export type PaceShotManifestPaceFieldArgs = {
  path: Scalars['String']['input'];
};

/** shot 级世界坐标 blocking(dormant→Phase 3;S2 可写粗 blocking)。一次场景推理、逐镜落盘:同一实体跨镜默认同坐标,人工可逐镜 override(field_meta per-field 保护)。 */
export type PaceShotManifestPhysicalLayout = {
  __typename?: 'PaceShotManifestPhysicalLayout';
  /** 本镜预设摄影机机位(单镜单机位;焦距权威在 camera 柱 focalLengthMm,此处 lensMm 仅作粗值)。 */
  cameraSetup?: Maybe<PaceShotManifestPhysicalLayoutCameraSetup>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 本镜焦点坐标列表(相机/视线/灯共瞄)。 */
  focusPoints?: Maybe<Array<Maybe<PaceShotManifestPhysicalLayoutFocusPointsItem>>>;
  /** 布局坐标参考系。 */
  frameOfReference?: Maybe<PaceShotManifestPhysicalLayoutFrameOfReferenceEnum>;
  /** dormant(L-G) */
  groups?: Maybe<Array<Maybe<Scalars['JSON']['output']>>>;
  /** 本镜在场道具的世界站位。 */
  props?: Maybe<Array<Maybe<PaceWorldEntity>>>;
  /** dormant(L-D, PointInstancer 参数) */
  scatter?: Maybe<Scalars['JSON']['output']>;
  /** 本镜在场主体的世界站位。 */
  subjects?: Maybe<Array<Maybe<PaceWorldEntity>>>;
  /** 布局坐标单位。 */
  units?: Maybe<Scalars['String']['output']>;
  /** 世界坐标上方向轴。 */
  upAxis?: Maybe<Scalars['String']['output']>;
  /** dormant(L-H) */
  visibility?: Maybe<Scalars['JSON']['output']>;
};


/** shot 级世界坐标 blocking(dormant→Phase 3;S2 可写粗 blocking)。一次场景推理、逐镜落盘:同一实体跨镜默认同坐标,人工可逐镜 override(field_meta per-field 保护)。 */
export type PaceShotManifestPhysicalLayoutFieldArgs = {
  path: Scalars['String']['input'];
};

/** 本镜预设摄影机机位(单镜单机位;焦距权威在 camera 柱 focalLengthMm,此处 lensMm 仅作粗值)。 */
export type PaceShotManifestPhysicalLayoutCameraSetup = {
  __typename?: 'PaceShotManifestPhysicalLayoutCameraSetup';
  field?: Maybe<Scalars['JSON']['output']>;
  /** PACE 字段 `physicalLayout.cameraSetup.lensMm`,用于记录lensmm。 */
  lensMm?: Maybe<Scalars['Float']['output']>;
  /** focusPoint id 或坐标引用 */
  lookingAt?: Maybe<Scalars['String']['output']>;
  /** PACE 字段 `physicalLayout.cameraSetup.worldXy`,用于记录worldxy。 */
  worldXy: Array<Maybe<Scalars['Float']['output']>>;
  /** PACE 字段 `physicalLayout.cameraSetup.z`,用于记录z。 */
  z?: Maybe<Scalars['Float']['output']>;
};


/** 本镜预设摄影机机位(单镜单机位;焦距权威在 camera 柱 focalLengthMm,此处 lensMm 仅作粗值)。 */
export type PaceShotManifestPhysicalLayoutCameraSetupFieldArgs = {
  path: Scalars['String']['input'];
};

/** 数组 `physicalLayout.focusPoints[]` 的元素结构。类型为 object。 */
export type PaceShotManifestPhysicalLayoutFocusPointsItem = {
  __typename?: 'PaceShotManifestPhysicalLayoutFocusPointsItem';
  field?: Maybe<Scalars['JSON']['output']>;
  /** PACE 字段 `physicalLayout.focusPoints.[].id`,用于记录ID。 */
  id: Scalars['String']['output'];
  /** PACE 字段 `physicalLayout.focusPoints.[].worldXy`,用于记录worldxy。 */
  worldXy: Array<Maybe<Scalars['Float']['output']>>;
  /** PACE 字段 `physicalLayout.focusPoints.[].z`,用于记录z。 */
  z?: Maybe<Scalars['Float']['output']>;
};


/** 数组 `physicalLayout.focusPoints[]` 的元素结构。类型为 object。 */
export type PaceShotManifestPhysicalLayoutFocusPointsItemFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceShotManifestPhysicalLayoutFrameOfReferenceEnum {
  StageTopView = 'stage_top_view',
  WorldXy = 'world_xy'
}

/** 编译产物 prompt 条目。 */
export type PaceShotManifestPromptsItem = {
  __typename?: 'PaceShotManifestPromptsItem';
  field?: Maybe<Scalars['JSON']['output']>;
  /** prompt/compiler 标识,如 v1T2i、v2FluxEdit、videoGeneration。 */
  id: Scalars['String']['output'];
  /** 编译后的 prompt 文本。 */
  text: Scalars['String']['output'];
};


/** 编译产物 prompt 条目。 */
export type PaceShotManifestPromptsItemFieldArgs = {
  path: Scalars['String']['input'];
};

/** dormant(Phase 3)。渲染产出规格(下游 ComfyUI 工作流按它读取);primId = 渲染器逐像素对象 ID 图,替代手工 mask。 */
export type PaceShotManifestRenderOutputs = {
  __typename?: 'PaceShotManifestRenderOutputs';
  /** 渲染 AOV 输出列表。 */
  aovs?: Maybe<Array<Maybe<PaceShotManifestRenderOutputsAovsItemEnum>>>;
  /** 输出位深。 */
  bitDepth?: Maybe<Scalars['Int']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 输出分辨率。 */
  resolution?: Maybe<Array<Maybe<Scalars['Int']['output']>>>;
};


/** dormant(Phase 3)。渲染产出规格(下游 ComfyUI 工作流按它读取);primId = 渲染器逐像素对象 ID 图,替代手工 mask。 */
export type PaceShotManifestRenderOutputsFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceShotManifestRenderOutputsAovsItemEnum {
  Color = 'color',
  Depth = 'depth',
  Mask = 'mask',
  MotionVector = 'motion_vector',
  Normal = 'normal',
  PrimId = 'primId'
}

/** 人工或自动审核状态。 */
export type PaceShotManifestReview = {
  __typename?: 'PaceShotManifestReview';
  /** 是否批准进入下一阶段。 */
  approvedForNextStage?: Maybe<Scalars['Boolean']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 人工备注。 */
  notes?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  /** 七维 × L0–L4 评分;关键节点全 ≥3 = Director-Ready */
  paceQa?: Maybe<PaceShotManifestReviewPaceQa>;
  /** 阶段 1 审核是否通过。 */
  stage1Ok?: Maybe<Scalars['Boolean']['output']>;
  /** 阶段 2 审核是否通过。 */
  stage2Ok?: Maybe<Scalars['Boolean']['output']>;
  /** 阶段 3 审核是否通过。 */
  stage3Ok?: Maybe<Scalars['Boolean']['output']>;
};


/** 人工或自动审核状态。 */
export type PaceShotManifestReviewFieldArgs = {
  path: Scalars['String']['input'];
};

/** 七维 × L0–L4 评分;关键节点全 ≥3 = Director-Ready */
export type PaceShotManifestReviewPaceQa = {
  __typename?: 'PaceShotManifestReviewPaceQa';
  /** PACE 字段 `review.paceQa.D1`,用于记录d1。 */
  D1?: Maybe<Scalars['Int']['output']>;
  /** PACE 字段 `review.paceQa.D2`,用于记录d2。 */
  D2?: Maybe<Scalars['Int']['output']>;
  /** PACE 字段 `review.paceQa.D3`,用于记录d3。 */
  D3?: Maybe<Scalars['Int']['output']>;
  /** PACE 字段 `review.paceQa.D4`,用于记录d4。 */
  D4?: Maybe<Scalars['Int']['output']>;
  /** PACE 字段 `review.paceQa.D5`,用于记录d5。 */
  D5?: Maybe<Scalars['Int']['output']>;
  /** PACE 字段 `review.paceQa.D6`,用于记录d6。 */
  D6?: Maybe<Scalars['Int']['output']>;
  /** PACE 字段 `review.paceQa.D7`,用于记录d7。 */
  D7?: Maybe<Scalars['Int']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
};


/** 七维 × L0–L4 评分;关键节点全 ≥3 = Director-Ready */
export type PaceShotManifestReviewPaceQaFieldArgs = {
  path: Scalars['String']['input'];
};

export type PaceStandard = {
  __typename?: 'PaceStandard';
  registry: Array<Scalars['String']['output']>;
  schema: Array<Scalars['String']['output']>;
  vocab: Array<Scalars['String']['output']>;
};

/** 复用结构 `subject`,用于 `pillar.setup.schema.json` 中的嵌套对象。 */
export type PaceSubject = {
  __typename?: 'PaceSubject';
  /** 配饰列表。 */
  accessories?: Maybe<Scalars['String']['output']>;
  /** 角色年龄或阶段状态。 */
  ageState?: Maybe<Scalars['String']['output']>;
  /** 角色 ID。 */
  characterId?: Maybe<Scalars['String']['output']>;
  /** 分类标签。 */
  cls?: Maybe<Scalars['String']['output']>;
  /** 服装描述。 */
  costume?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 视线或注视关系。 */
  gaze?: Maybe<PaceGaze>;
  /** 发型描述。 */
  hair?: Maybe<Scalars['String']['output']>;
  /** 妆容描述。 */
  makeup?: Maybe<Scalars['String']['output']>;
  /** 姿态描述。 */
  pose?: Maybe<Scalars['String']['output']>;
  /** 比例特征。 */
  proportions?: Maybe<Scalars['String']['output']>;
  /** 画面中的屏幕位置。 */
  screenPosition?: Maybe<PaceScreenPosition>;
  /** 轮廓特征。 */
  silhouette?: Maybe<Scalars['String']['output']>;
};


/** 复用结构 `subject`,用于 `pillar.setup.schema.json` 中的嵌套对象。 */
export type PaceSubjectFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceTemporalEnum {
  Atomic = 'atomic',
  Causal = 'causal',
  Concurrent = 'concurrent',
  Cyclic = 'cyclic',
  Overlapping = 'overlapping',
  Reverse = 'reverse',
  Sequential = 'sequential'
}

/** 复用结构 `textElement`,用于 `pillar.setup.schema.json` 中的嵌套对象。 */
export type PaceTextElement = {
  __typename?: 'PaceTextElement';
  /** 文本内容。 */
  content?: Maybe<Scalars['String']['output']>;
  /** 数量。 */
  count?: Maybe<Scalars['Int']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** 语言代码或语言描述。 */
  language?: Maybe<Scalars['String']['output']>;
  /** 布局。 */
  layout?: Maybe<PaceTextElementLayoutEnum>;
  /** 备注。 */
  note?: Maybe<Scalars['String']['output']>;
  /** 视觉风格。 */
  style?: Maybe<PaceTextElementStyleEnum>;
  /** 目标对象。 */
  target?: Maybe<PaceTextElementTargetEnum>;
};


/** 复用结构 `textElement`,用于 `pillar.setup.schema.json` 中的嵌套对象。 */
export type PaceTextElementFieldArgs = {
  path: Scalars['String']['input'];
};

export enum PaceTextElementLayoutEnum {
  BodyParagraph = 'body_paragraph',
  HeaderOnly = 'header_only',
  HeadlineOnly = 'headline_only',
  InputBox = 'input_box',
  List = 'list',
  SingleBubble = 'single_bubble',
  TwoColumn = 'two_column'
}

export enum PaceTextElementStyleEnum {
  Calligraphy = 'calligraphy',
  Carved = 'carved',
  Embroidered = 'embroidered',
  Handwritten = 'handwritten',
  Neon = 'neon',
  Printed = 'printed',
  Stamped = 'stamped'
}

export enum PaceTextElementTargetEnum {
  Banner = 'banner',
  Billboard = 'billboard',
  BookPage = 'book_page',
  CarvedStone = 'carved_stone',
  Letter = 'letter',
  Newspaper = 'newspaper',
  PhoneScreen = 'phone_screen',
  Scroll = 'scroll',
  Sign = 'sign',
  Subtitle = 'subtitle',
  Tattoo = 'tattoo',
  TitleCard = 'title_card',
  WallGraffiti = 'wall_graffiti'
}

export type PaceValidation = {
  __typename?: 'PaceValidation';
  issues: Array<PaceValidationIssue>;
  ok: Scalars['Boolean']['output'];
};

export type PaceValidationIssue = {
  __typename?: 'PaceValidationIssue';
  code?: Maybe<Scalars['String']['output']>;
  field?: Maybe<Scalars['String']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  path?: Maybe<Scalars['String']['output']>;
  schemaPath?: Maybe<Scalars['String']['output']>;
};

/** 复用结构 `worldEntity`,用于 `shot_manifest.schema.json` 中的嵌套对象。 */
export type PaceWorldEntity = {
  __typename?: 'PaceWorldEntity';
  /** PACE 字段 `definitions.worldEntity.bbox`,用于记录bbox。 */
  bbox?: Maybe<Array<Maybe<Scalars['Float']['output']>>>;
  /** PACE 字段 `definitions.worldEntity.facingDeg`,用于记录facingdeg。 */
  facingDeg?: Maybe<Scalars['Float']['output']>;
  field?: Maybe<Scalars['JSON']['output']>;
  /** PACE 字段 `definitions.worldEntity.pitchDeg`,用于记录pitchdeg。 */
  pitchDeg?: Maybe<Scalars['Float']['output']>;
  /** id@version 或 prop_id */
  ref: Scalars['String']['output'];
  /** PACE 字段 `definitions.worldEntity.rollDeg`,用于记录rolldeg。 */
  rollDeg?: Maybe<Scalars['Float']['output']>;
  /** 空间或对象尺度。 */
  scale?: Maybe<Scalars['Float']['output']>;
  /** PACE 字段 `definitions.worldEntity.worldXy`,用于记录worldxy。 */
  worldXy: Array<Maybe<Scalars['Float']['output']>>;
  /** PACE 字段 `definitions.worldEntity.z`,用于记录z。 */
  z?: Maybe<Scalars['Float']['output']>;
};


/** 复用结构 `worldEntity`,用于 `shot_manifest.schema.json` 中的嵌套对象。 */
export type PaceWorldEntityFieldArgs = {
  path: Scalars['String']['input'];
};

export type Project = {
  __typename?: 'Project';
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  source?: Maybe<Scalars['String']['output']>;
  version?: Maybe<ProjectVersionSummary>;
};

export type ProjectCreateResult = {
  __typename?: 'ProjectCreateResult';
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  version?: Maybe<ProjectVersionSummary>;
};

export type ProjectDeleteResult = {
  __typename?: 'ProjectDeleteResult';
  deleted: Scalars['Boolean']['output'];
  deletedAt?: Maybe<Scalars['String']['output']>;
  project: Scalars['String']['output'];
  recycledPath?: Maybe<Scalars['String']['output']>;
};

export type ProjectTree = {
  __typename?: 'ProjectTree';
  panelCount: Scalars['Int']['output'];
  project: Project;
  sceneCount: Scalars['Int']['output'];
  scenes: Array<ProjectTreeScene>;
  shotCount: Scalars['Int']['output'];
};

export type ProjectTreePanel = {
  __typename?: 'ProjectTreePanel';
  hasPaiLang: Scalars['Boolean']['output'];
  hasV1Storyboard: Scalars['Boolean']['output'];
  hasV2Storyboard: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  kind?: Maybe<Scalars['String']['output']>;
  panelNumber?: Maybe<Scalars['Int']['output']>;
  shotSize?: Maybe<Scalars['String']['output']>;
};

export type ProjectTreeScene = {
  __typename?: 'ProjectTreeScene';
  heading?: Maybe<Scalars['String']['output']>;
  panelCount?: Maybe<Scalars['Int']['output']>;
  sceneId: Scalars['String']['output'];
  shotCount?: Maybe<Scalars['Int']['output']>;
  shots: Array<ProjectTreeShot>;
  summary?: Maybe<Scalars['String']['output']>;
};

export type ProjectTreeShot = {
  __typename?: 'ProjectTreeShot';
  id: Scalars['String']['output'];
  paceReady: Scalars['Boolean']['output'];
  panelCount: Scalars['Int']['output'];
  panels: Array<ProjectTreePanel>;
  review?: Maybe<ProjectTreeShotReview>;
  sceneHeading?: Maybe<Scalars['String']['output']>;
  sceneId?: Maybe<Scalars['String']['output']>;
  sceneSummary?: Maybe<Scalars['String']['output']>;
  shotDescriptionEn?: Maybe<Scalars['String']['output']>;
  shotDescriptionZh?: Maybe<Scalars['String']['output']>;
  versionStatus?: Maybe<Scalars['String']['output']>;
};

export type ProjectTreeShotReview = {
  __typename?: 'ProjectTreeShotReview';
  approvedForNextStage: Scalars['Boolean']['output'];
  stage1Ok: Scalars['Boolean']['output'];
  stage2Ok: Scalars['Boolean']['output'];
  stage3Ok: Scalars['Boolean']['output'];
};

export type ProjectVersion = {
  __typename?: 'ProjectVersion';
  comment?: Maybe<Scalars['String']['output']>;
  committedAt?: Maybe<Scalars['String']['output']>;
  shortId?: Maybe<Scalars['String']['output']>;
  versionId?: Maybe<Scalars['String']['output']>;
};

export type ProjectVersionCleanResult = {
  __typename?: 'ProjectVersionCleanResult';
  cleanedPaths: Array<Scalars['String']['output']>;
  cleanedPathsCount: Scalars['Int']['output'];
  current: ProjectVersionState;
  previous: ProjectVersionState;
};

export type ProjectVersionCommitResult = {
  __typename?: 'ProjectVersionCommitResult';
  authorEmail: Scalars['String']['output'];
  authorName: Scalars['String']['output'];
  comment: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  dirty: Scalars['Boolean']['output'];
  dirtyPaths: Array<Scalars['String']['output']>;
  dirtyPathsCount: Scalars['Int']['output'];
  shortId?: Maybe<Scalars['String']['output']>;
  versionId?: Maybe<Scalars['String']['output']>;
};

export type ProjectVersionDeleteResult = {
  __typename?: 'ProjectVersionDeleteResult';
  current: ProjectVersionState;
  deletedVersion: ProjectVersion;
};

export type ProjectVersionHead = {
  __typename?: 'ProjectVersionHead';
  shortId?: Maybe<Scalars['String']['output']>;
  versionId?: Maybe<Scalars['String']['output']>;
};

export type ProjectVersionRestoreResult = {
  __typename?: 'ProjectVersionRestoreResult';
  current: ProjectVersionState;
  headBefore: ProjectVersionHead;
  restoredVersion: ProjectVersion;
};

export type ProjectVersionState = {
  __typename?: 'ProjectVersionState';
  dirty: Scalars['Boolean']['output'];
  dirtyPaths: Array<Scalars['String']['output']>;
  dirtyPathsCount: Scalars['Int']['output'];
  shortId?: Maybe<Scalars['String']['output']>;
  versionId?: Maybe<Scalars['String']['output']>;
};

export type ProjectVersionSummary = {
  __typename?: 'ProjectVersionSummary';
  current?: Maybe<Scalars['String']['output']>;
  dirty?: Maybe<Scalars['Boolean']['output']>;
  dirtyPathsCount?: Maybe<Scalars['Int']['output']>;
  shortId?: Maybe<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  agentContext: AgentContext;
  assetUrl: AssetUrl;
  chatMessages: Array<ChatMessage>;
  chatThread: ChatThread;
  chatThreads: Array<ChatThread>;
  job: Job;
  jobDebug: JobDebug;
  jobs: Array<Job>;
  paceFile: PaceFile;
  paceFileIndex: Array<PaceFileMeta>;
  paceStandard: PaceStandard;
  paceStandardRegistry: Scalars['JSON']['output'];
  paceStandardSchema: Scalars['JSON']['output'];
  paceStandardVocab: Scalars['JSON']['output'];
  project?: Maybe<Project>;
  projectTree: ProjectTree;
  projectVersion: ProjectVersionState;
  projectVersions: Array<ProjectVersion>;
  projects: Array<Project>;
  validatePaceProject: PaceValidation;
  viewer?: Maybe<User>;
  workers: Array<Worker>;
};


export type QueryAgentContextArgs = {
  input: AgentContextInput;
};


export type QueryAssetUrlArgs = {
  assetsUri: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};


export type QueryChatMessagesArgs = {
  threadId: Scalars['String']['input'];
};


export type QueryChatThreadArgs = {
  threadId: Scalars['String']['input'];
};


export type QueryChatThreadsArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryJobArgs = {
  jobId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  refresh?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryJobDebugArgs = {
  jobId: Scalars['String']['input'];
  refresh?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryJobsArgs = {
  kind?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
  refresh?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryPaceFileArgs = {
  path: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};


export type QueryPaceFileIndexArgs = {
  prefix: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};


export type QueryPaceStandardRegistryArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
};


export type QueryPaceStandardSchemaArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
};


export type QueryPaceStandardVocabArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
};


export type QueryProjectArgs = {
  id: Scalars['String']['input'];
};


export type QueryProjectTreeArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryProjectVersionArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryProjectVersionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
};


export type QueryValidatePaceProjectArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryWorkersArgs = {
  verbose?: InputMaybe<Scalars['Boolean']['input']>;
};

export type User = {
  __typename?: 'User';
  displayName?: Maybe<Scalars['String']['output']>;
  email?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  status?: Maybe<Scalars['String']['output']>;
};

export type Worker = {
  __typename?: 'Worker';
  name: Scalars['String']['output'];
  status?: Maybe<Scalars['String']['output']>;
  tasks: Array<WorkerTask>;
};

export type WorkerHeartbeatInput = {
  extra?: InputMaybe<Scalars['JSON']['input']>;
  heartbeatAt?: InputMaybe<Scalars['String']['input']>;
  message?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
};

export type WorkerHeartbeatResult = {
  __typename?: 'WorkerHeartbeatResult';
  lastSeenAt?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  status: Scalars['String']['output'];
  worker?: Maybe<Worker>;
};

export type WorkerRegistrationInput = {
  credentials: Scalars['JSON']['input'];
  descriptionMd?: InputMaybe<Scalars['String']['input']>;
  heartbeat?: InputMaybe<Scalars['JSON']['input']>;
  schema: Scalars['JSON']['input'];
  workerName?: InputMaybe<Scalars['String']['input']>;
};

export type WorkerRegistrationResult = {
  __typename?: 'WorkerRegistrationResult';
  name: Scalars['String']['output'];
  status: Scalars['String']['output'];
  worker?: Maybe<Worker>;
};

export type WorkerTask = {
  __typename?: 'WorkerTask';
  agentInstructions?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  inputProperties?: Maybe<Scalars['JSON']['output']>;
  inputRequired: Array<Scalars['String']['output']>;
  inputSchema?: Maybe<Scalars['JSON']['output']>;
  inputSchemaVersion?: Maybe<Scalars['String']['output']>;
  outputSchema?: Maybe<Scalars['JSON']['output']>;
  payloadSchema?: Maybe<Scalars['JSON']['output']>;
  summary?: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

export type WorkerTaskSubmitResult = {
  __typename?: 'WorkerTaskSubmitResult';
  jobId: Scalars['String']['output'];
  project?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  statusUrl?: Maybe<Scalars['String']['output']>;
  taskType?: Maybe<Scalars['String']['output']>;
  workerName?: Maybe<Scalars['String']['output']>;
};

export type AddChatMessage_MutationMutationVariables = Exact<{
  input: ChatMessageInput;
  threadId: Scalars['String']['input'];
}>;


export type AddChatMessage_MutationMutation = { __typename?: 'Mutation', addChatMessage: { __typename?: 'ChatMessage', contentJson?: unknown | null, contentText: string, createdAt?: string | null, id: string, projectId?: string | null, role: string, status: string, threadId: string } };

export type CleanProjectWorktree_MutationMutationVariables = Exact<{
  projectId: Scalars['String']['input'];
}>;


export type CleanProjectWorktree_MutationMutation = { __typename?: 'Mutation', cleanProjectWorktree: { __typename?: 'ProjectVersionCleanResult', cleanedPaths: Array<string>, cleanedPathsCount: number, current: { __typename?: 'ProjectVersionState', dirty: boolean, dirtyPaths: Array<string>, dirtyPathsCount: number, shortId?: string | null, versionId?: string | null }, previous: { __typename?: 'ProjectVersionState', dirty: boolean, dirtyPaths: Array<string>, dirtyPathsCount: number, shortId?: string | null, versionId?: string | null } } };

export type CommitProjectVersion_MutationMutationVariables = Exact<{
  comment: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
}>;


export type CommitProjectVersion_MutationMutation = { __typename?: 'Mutation', commitProjectVersion: { __typename?: 'ProjectVersionCommitResult', authorEmail: string, authorName: string, comment: string, createdAt: string, dirty: boolean, dirtyPaths: Array<string>, dirtyPathsCount: number, shortId?: string | null, versionId?: string | null } };

export type CreateAssetUploadUrl_MutationMutationVariables = Exact<{
  assetKind: AssetKind;
  contentType: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
}>;


export type CreateAssetUploadUrl_MutationMutation = { __typename?: 'Mutation', createAssetUploadUrl: { __typename?: 'AssetUploadUrl', assetsUri: string, expiresIn: number, headers: unknown, objectKey: string, uploadUrl: string } };

export type CreateChatThread_MutationMutationVariables = Exact<{
  input: ChatThreadInput;
}>;


export type CreateChatThread_MutationMutation = { __typename?: 'Mutation', createChatThread: { __typename?: 'ChatThread', createdAt?: string | null, createdBy?: string | null, id: string, projectId: string, relatedJobId?: string | null, relatedPanelId?: string | null, relatedSceneId?: string | null, scope: string, title: string, updatedAt?: string | null } };

export type CreateProject_MutationMutationVariables = Exact<{
  input: CreateProjectInput;
}>;


export type CreateProject_MutationMutation = { __typename?: 'Mutation', createProject: { __typename?: 'ProjectCreateResult', id: string, name?: string | null, status?: string | null, version?: { __typename?: 'ProjectVersionSummary', current?: string | null, dirty?: boolean | null, dirtyPathsCount?: number | null, shortId?: string | null } | null } };

export type DeletePaceFiles_MutationMutationVariables = Exact<{
  paths: Array<Scalars['String']['input']> | Scalars['String']['input'];
  projectId: Scalars['String']['input'];
}>;


export type DeletePaceFiles_MutationMutation = { __typename?: 'Mutation', deletePaceFiles: { __typename?: 'PaceFilesDeleteResult', project: string, deleted: Array<{ __typename?: 'PaceFilesDeletedItem', path: string, type: string }>, recycled: Array<{ __typename?: 'PaceFilesRecycledItem', path: string, recycledPath: string }>, validation: { __typename?: 'PaceValidation', ok: boolean, issues: Array<{ __typename?: 'PaceValidationIssue', code?: string | null, field?: string | null, message?: string | null, path?: string | null, schemaPath?: string | null }> } } };

export type DeleteProject_MutationMutationVariables = Exact<{
  projectId: Scalars['String']['input'];
}>;


export type DeleteProject_MutationMutation = { __typename?: 'Mutation', deleteProject: { __typename?: 'ProjectDeleteResult', deleted: boolean, deletedAt?: string | null, project: string, recycledPath?: string | null } };

export type DeleteProjectVersion_MutationMutationVariables = Exact<{
  projectId: Scalars['String']['input'];
  versionId: Scalars['String']['input'];
}>;


export type DeleteProjectVersion_MutationMutation = { __typename?: 'Mutation', deleteProjectVersion: { __typename?: 'ProjectVersionDeleteResult', current: { __typename?: 'ProjectVersionState', dirty: boolean, dirtyPaths: Array<string>, dirtyPathsCount: number, shortId?: string | null, versionId?: string | null }, deletedVersion: { __typename?: 'ProjectVersion', comment?: string | null, committedAt?: string | null, shortId?: string | null, versionId?: string | null } } };

export type HeartbeatWorker_MutationMutationVariables = Exact<{
  input: WorkerHeartbeatInput;
  workerName: Scalars['String']['input'];
}>;


export type HeartbeatWorker_MutationMutation = { __typename?: 'Mutation', heartbeatWorker: { __typename?: 'WorkerHeartbeatResult', lastSeenAt?: string | null, name: string, status: string, worker?: { __typename?: 'Worker', name: string, status?: string | null, tasks: Array<{ __typename?: 'WorkerTask', agentInstructions?: string | null, description?: string | null, inputProperties?: unknown | null, inputRequired: Array<string>, inputSchema?: unknown | null, inputSchemaVersion?: string | null, outputSchema?: unknown | null, payloadSchema?: unknown | null, summary?: string | null, type: string }> } | null } };

export type Login_MutationMutationVariables = Exact<{
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
}>;


export type Login_MutationMutation = { __typename?: 'Mutation', login: { __typename?: 'AuthPayload', token: string, user: { __typename?: 'User', displayName?: string | null, email?: string | null, id: string, status?: string | null } } };

export type Logout_MutationMutationVariables = Exact<{ [key: string]: never; }>;


export type Logout_MutationMutation = { __typename?: 'Mutation', logout: { __typename?: 'LogoutPayload', loggedOut: boolean } };

export type Register_MutationMutationVariables = Exact<{
  displayName: Scalars['String']['input'];
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
}>;


export type Register_MutationMutation = { __typename?: 'Mutation', register: { __typename?: 'AuthPayload', token: string, user: { __typename?: 'User', displayName?: string | null, email?: string | null, id: string, status?: string | null } } };

export type RegisterWorker_MutationMutationVariables = Exact<{
  input: WorkerRegistrationInput;
}>;


export type RegisterWorker_MutationMutation = { __typename?: 'Mutation', registerWorker: { __typename?: 'WorkerRegistrationResult', name: string, status: string, worker?: { __typename?: 'Worker', name: string, status?: string | null, tasks: Array<{ __typename?: 'WorkerTask', agentInstructions?: string | null, description?: string | null, inputProperties?: unknown | null, inputRequired: Array<string>, inputSchema?: unknown | null, inputSchemaVersion?: string | null, outputSchema?: unknown | null, payloadSchema?: unknown | null, summary?: string | null, type: string }> } | null } };

export type RestoreProjectVersion_MutationMutationVariables = Exact<{
  projectId: Scalars['String']['input'];
  versionId: Scalars['String']['input'];
}>;


export type RestoreProjectVersion_MutationMutation = { __typename?: 'Mutation', restoreProjectVersion: { __typename?: 'ProjectVersionRestoreResult', current: { __typename?: 'ProjectVersionState', dirty: boolean, dirtyPaths: Array<string>, dirtyPathsCount: number, shortId?: string | null, versionId?: string | null }, headBefore: { __typename?: 'ProjectVersionHead', shortId?: string | null, versionId?: string | null }, restoredVersion: { __typename?: 'ProjectVersion', comment?: string | null, committedAt?: string | null, shortId?: string | null, versionId?: string | null } } };

export type RunWorkerTask_MutationMutationVariables = Exact<{
  payload?: InputMaybe<Scalars['JSON']['input']>;
  projectId: Scalars['String']['input'];
  taskType: Scalars['String']['input'];
  workerName: Scalars['String']['input'];
}>;


export type RunWorkerTask_MutationMutation = { __typename?: 'Mutation', runWorkerTask: { __typename?: 'WorkerTaskSubmitResult', jobId: string, project?: string | null, status?: string | null, statusUrl?: string | null, taskType?: string | null, workerName?: string | null } };

export type SendAgentMessage_MutationMutationVariables = Exact<{
  input: AgentChatInput;
}>;


export type SendAgentMessage_MutationMutation = { __typename?: 'Mutation', sendAgentMessage: { __typename?: 'AgentChatResult', actions: Array<unknown>, contextUsed?: unknown | null, meta?: unknown | null, summary: string, warnings: Array<string>, widgets?: unknown | null } };

export type UpdateWorkerRegistration_MutationMutationVariables = Exact<{
  input: WorkerRegistrationInput;
  workerName: Scalars['String']['input'];
}>;


export type UpdateWorkerRegistration_MutationMutation = { __typename?: 'Mutation', updateWorkerRegistration: { __typename?: 'WorkerRegistrationResult', name: string, status: string, worker?: { __typename?: 'Worker', name: string, status?: string | null, tasks: Array<{ __typename?: 'WorkerTask', agentInstructions?: string | null, description?: string | null, inputProperties?: unknown | null, inputRequired: Array<string>, inputSchema?: unknown | null, inputSchemaVersion?: string | null, outputSchema?: unknown | null, payloadSchema?: unknown | null, summary?: string | null, type: string }> } | null } };

export type WritePaceFiles_MutationMutationVariables = Exact<{
  patches?: InputMaybe<Array<PaceFilePatchInput> | PaceFilePatchInput>;
  projectId: Scalars['String']['input'];
  writes?: InputMaybe<Array<PaceFileWriteInput> | PaceFileWriteInput>;
}>;


export type WritePaceFiles_MutationMutation = { __typename?: 'Mutation', writePaceFiles: { __typename?: 'PaceFilesWriteResult', project: string, changed: Array<{ __typename?: 'PaceFilesChangedItem', format: string, kind: string, path: string }>, validation: { __typename?: 'PaceValidation', ok: boolean, issues: Array<{ __typename?: 'PaceValidationIssue', code?: string | null, field?: string | null, message?: string | null, path?: string | null, schemaPath?: string | null }> } } };

export type AgentContext_QueryQueryVariables = Exact<{
  input: AgentContextInput;
}>;


export type AgentContext_QueryQuery = { __typename?: 'Query', agentContext: { __typename?: 'AgentContext', focus: unknown } };

export type AssetUrl_QueryQueryVariables = Exact<{
  assetsUri: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
}>;


export type AssetUrl_QueryQuery = { __typename?: 'Query', assetUrl: { __typename?: 'AssetUrl', assetsUri: string, url: string } };

export type ChatMessages_QueryQueryVariables = Exact<{
  threadId: Scalars['String']['input'];
}>;


export type ChatMessages_QueryQuery = { __typename?: 'Query', chatMessages: Array<{ __typename?: 'ChatMessage', contentJson?: unknown | null, contentText: string, createdAt?: string | null, id: string, projectId?: string | null, role: string, status: string, threadId: string }> };

export type ChatThread_QueryQueryVariables = Exact<{
  threadId: Scalars['String']['input'];
}>;


export type ChatThread_QueryQuery = { __typename?: 'Query', chatThread: { __typename?: 'ChatThread', createdAt?: string | null, createdBy?: string | null, id: string, projectId: string, relatedJobId?: string | null, relatedPanelId?: string | null, relatedSceneId?: string | null, scope: string, title: string, updatedAt?: string | null } };

export type ChatThreads_QueryQueryVariables = Exact<{
  projectId: Scalars['String']['input'];
}>;


export type ChatThreads_QueryQuery = { __typename?: 'Query', chatThreads: Array<{ __typename?: 'ChatThread', createdAt?: string | null, createdBy?: string | null, id: string, projectId: string, relatedJobId?: string | null, relatedPanelId?: string | null, relatedSceneId?: string | null, scope: string, title: string, updatedAt?: string | null }> };

export type Job_QueryQueryVariables = Exact<{
  jobId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  refresh?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type Job_QueryQuery = { __typename?: 'Query', job: { __typename?: 'Job', error?: string | null, eta?: number | null, filename?: string | null, jobId: string, kind?: string | null, progress?: number | null, project?: string | null, renderUrl?: string | null, renderUrls: Array<string>, result: Array<string>, sceneCount?: number | null, seed?: number | null, status?: string | null } };

export type JobDebug_QueryQueryVariables = Exact<{
  jobId: Scalars['String']['input'];
  refresh?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type JobDebug_QueryQuery = { __typename?: 'Query', jobDebug: { __typename?: 'JobDebug', diagnostics: unknown, job: unknown, request: unknown, result: unknown, worker?: unknown | null, workerTask?: unknown | null } };

export type Jobs_QueryQueryVariables = Exact<{
  kind?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
  refresh?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type Jobs_QueryQuery = { __typename?: 'Query', jobs: Array<{ __typename?: 'Job', error?: string | null, eta?: number | null, filename?: string | null, jobId: string, kind?: string | null, progress?: number | null, project?: string | null, renderUrl?: string | null, renderUrls: Array<string>, result: Array<string>, sceneCount?: number | null, seed?: number | null, status?: string | null }> };

export type PaceFile_QueryQueryVariables = Exact<{
  path: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
}>;


export type PaceFile_QueryQuery = { __typename?: 'Query', paceFile: { __typename?: 'PaceFile', format: string, kind: string, path: string, project: string, sizeBytes: number, updatedAt?: string | null, value: unknown } };

export type PaceFileIndex_QueryQueryVariables = Exact<{
  prefix: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
}>;


export type PaceFileIndex_QueryQuery = { __typename?: 'Query', paceFileIndex: Array<{ __typename?: 'PaceFileMeta', format: string, kind: string, path: string, project: string, sizeBytes: number, updatedAt?: string | null }> };

export type PaceStandard_QueryQueryVariables = Exact<{ [key: string]: never; }>;


export type PaceStandard_QueryQuery = { __typename?: 'Query', paceStandard: { __typename?: 'PaceStandard', registry: Array<string>, schema: Array<string>, vocab: Array<string> } };

export type PaceStandardRegistry_QueryQueryVariables = Exact<{
  name?: InputMaybe<Scalars['String']['input']>;
}>;


export type PaceStandardRegistry_QueryQuery = { __typename?: 'Query', paceStandardRegistry: unknown };

export type PaceStandardSchema_QueryQueryVariables = Exact<{
  name?: InputMaybe<Scalars['String']['input']>;
}>;


export type PaceStandardSchema_QueryQuery = { __typename?: 'Query', paceStandardSchema: unknown };

export type PaceStandardVocab_QueryQueryVariables = Exact<{
  name?: InputMaybe<Scalars['String']['input']>;
}>;


export type PaceStandardVocab_QueryQuery = { __typename?: 'Query', paceStandardVocab: unknown };

export type Project_QueryQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type Project_QueryQuery = { __typename?: 'Query', project?: { __typename?: 'Project', id: string, name?: string | null, source?: string | null, version?: { __typename?: 'ProjectVersionSummary', current?: string | null, dirty?: boolean | null, dirtyPathsCount?: number | null, shortId?: string | null } | null } | null };

export type ProjectTree_QueryQueryVariables = Exact<{
  projectId: Scalars['String']['input'];
}>;


export type ProjectTree_QueryQuery = { __typename?: 'Query', projectTree: { __typename?: 'ProjectTree', panelCount: number, sceneCount: number, shotCount: number, project: { __typename?: 'Project', id: string, name?: string | null, source?: string | null, version?: { __typename?: 'ProjectVersionSummary', current?: string | null, dirty?: boolean | null, dirtyPathsCount?: number | null, shortId?: string | null } | null }, scenes: Array<{ __typename?: 'ProjectTreeScene', heading?: string | null, panelCount?: number | null, sceneId: string, shotCount?: number | null, summary?: string | null, shots: Array<{ __typename?: 'ProjectTreeShot', id: string, paceReady: boolean, panelCount: number, sceneHeading?: string | null, sceneId?: string | null, sceneSummary?: string | null, shotDescriptionEn?: string | null, shotDescriptionZh?: string | null, versionStatus?: string | null }> }> } };

export type ProjectVersion_QueryQueryVariables = Exact<{
  projectId: Scalars['String']['input'];
}>;


export type ProjectVersion_QueryQuery = { __typename?: 'Query', projectVersion: { __typename?: 'ProjectVersionState', dirty: boolean, dirtyPaths: Array<string>, dirtyPathsCount: number, shortId?: string | null, versionId?: string | null } };

export type ProjectVersions_QueryQueryVariables = Exact<{
  limit?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
}>;


export type ProjectVersions_QueryQuery = { __typename?: 'Query', projectVersions: Array<{ __typename?: 'ProjectVersion', comment?: string | null, committedAt?: string | null, shortId?: string | null, versionId?: string | null }> };

export type Projects_QueryQueryVariables = Exact<{ [key: string]: never; }>;


export type Projects_QueryQuery = { __typename?: 'Query', projects: Array<{ __typename?: 'Project', id: string, name?: string | null, source?: string | null, version?: { __typename?: 'ProjectVersionSummary', current?: string | null, dirty?: boolean | null, dirtyPathsCount?: number | null, shortId?: string | null } | null }> };

export type ValidatePaceProject_QueryQueryVariables = Exact<{
  projectId: Scalars['String']['input'];
}>;


export type ValidatePaceProject_QueryQuery = { __typename?: 'Query', validatePaceProject: { __typename?: 'PaceValidation', ok: boolean, issues: Array<{ __typename?: 'PaceValidationIssue', code?: string | null, field?: string | null, message?: string | null, path?: string | null, schemaPath?: string | null }> } };

export type Viewer_QueryQueryVariables = Exact<{ [key: string]: never; }>;


export type Viewer_QueryQuery = { __typename?: 'Query', viewer?: { __typename?: 'User', displayName?: string | null, email?: string | null, id: string, status?: string | null } | null };

export type Workers_QueryQueryVariables = Exact<{
  verbose?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type Workers_QueryQuery = { __typename?: 'Query', workers: Array<{ __typename?: 'Worker', name: string, status?: string | null, tasks: Array<{ __typename?: 'WorkerTask', agentInstructions?: string | null, description?: string | null, inputProperties?: unknown | null, inputRequired: Array<string>, inputSchema?: unknown | null, inputSchemaVersion?: string | null, outputSchema?: unknown | null, payloadSchema?: unknown | null, summary?: string | null, type: string }> }> };


export const AddChatMessage_MutationDocument = `
    mutation addChatMessage_mutation($input: ChatMessageInput!, $threadId: String!) {
  addChatMessage(input: $input, threadId: $threadId) {
    contentJson
    contentText
    createdAt
    id
    projectId
    role
    status
    threadId
  }
}
    `;
export const CleanProjectWorktree_MutationDocument = `
    mutation cleanProjectWorktree_mutation($projectId: String!) {
  cleanProjectWorktree(projectId: $projectId) {
    cleanedPaths
    cleanedPathsCount
    current {
      dirty
      dirtyPaths
      dirtyPathsCount
      shortId
      versionId
    }
    previous {
      dirty
      dirtyPaths
      dirtyPathsCount
      shortId
      versionId
    }
  }
}
    `;
export const CommitProjectVersion_MutationDocument = `
    mutation commitProjectVersion_mutation($comment: String!, $projectId: String!) {
  commitProjectVersion(comment: $comment, projectId: $projectId) {
    authorEmail
    authorName
    comment
    createdAt
    dirty
    dirtyPaths
    dirtyPathsCount
    shortId
    versionId
  }
}
    `;
export const CreateAssetUploadUrl_MutationDocument = `
    mutation createAssetUploadUrl_mutation($assetKind: AssetKind!, $contentType: String!, $projectId: String!) {
  createAssetUploadUrl(
    assetKind: $assetKind
    contentType: $contentType
    projectId: $projectId
  ) {
    assetsUri
    expiresIn
    headers
    objectKey
    uploadUrl
  }
}
    `;
export const CreateChatThread_MutationDocument = `
    mutation createChatThread_mutation($input: ChatThreadInput!) {
  createChatThread(input: $input) {
    createdAt
    createdBy
    id
    projectId
    relatedJobId
    relatedPanelId
    relatedSceneId
    scope
    title
    updatedAt
  }
}
    `;
export const CreateProject_MutationDocument = `
    mutation createProject_mutation($input: CreateProjectInput!) {
  createProject(input: $input) {
    id
    name
    status
    version {
      current
      dirty
      dirtyPathsCount
      shortId
    }
  }
}
    `;
export const DeletePaceFiles_MutationDocument = `
    mutation deletePaceFiles_mutation($paths: [String!]!, $projectId: String!) {
  deletePaceFiles(paths: $paths, projectId: $projectId) {
    deleted {
      path
      type
    }
    project
    recycled {
      path
      recycledPath
    }
    validation {
      issues {
        code
        field
        message
        path
        schemaPath
      }
      ok
    }
  }
}
    `;
export const DeleteProject_MutationDocument = `
    mutation deleteProject_mutation($projectId: String!) {
  deleteProject(projectId: $projectId) {
    deleted
    deletedAt
    project
    recycledPath
  }
}
    `;
export const DeleteProjectVersion_MutationDocument = `
    mutation deleteProjectVersion_mutation($projectId: String!, $versionId: String!) {
  deleteProjectVersion(projectId: $projectId, versionId: $versionId) {
    current {
      dirty
      dirtyPaths
      dirtyPathsCount
      shortId
      versionId
    }
    deletedVersion {
      comment
      committedAt
      shortId
      versionId
    }
  }
}
    `;
export const HeartbeatWorker_MutationDocument = `
    mutation heartbeatWorker_mutation($input: WorkerHeartbeatInput!, $workerName: String!) {
  heartbeatWorker(input: $input, workerName: $workerName) {
    lastSeenAt
    name
    status
    worker {
      name
      status
      tasks {
        agentInstructions
        description
        inputProperties
        inputRequired
        inputSchema
        inputSchemaVersion
        outputSchema
        payloadSchema
        summary
        type
      }
    }
  }
}
    `;
export const Login_MutationDocument = `
    mutation login_mutation($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    token
    user {
      displayName
      email
      id
      status
    }
  }
}
    `;
export const Logout_MutationDocument = `
    mutation logout_mutation {
  logout {
    loggedOut
  }
}
    `;
export const Register_MutationDocument = `
    mutation register_mutation($displayName: String!, $email: String!, $password: String!) {
  register(displayName: $displayName, email: $email, password: $password) {
    token
    user {
      displayName
      email
      id
      status
    }
  }
}
    `;
export const RegisterWorker_MutationDocument = `
    mutation registerWorker_mutation($input: WorkerRegistrationInput!) {
  registerWorker(input: $input) {
    name
    status
    worker {
      name
      status
      tasks {
        agentInstructions
        description
        inputProperties
        inputRequired
        inputSchema
        inputSchemaVersion
        outputSchema
        payloadSchema
        summary
        type
      }
    }
  }
}
    `;
export const RestoreProjectVersion_MutationDocument = `
    mutation restoreProjectVersion_mutation($projectId: String!, $versionId: String!) {
  restoreProjectVersion(projectId: $projectId, versionId: $versionId) {
    current {
      dirty
      dirtyPaths
      dirtyPathsCount
      shortId
      versionId
    }
    headBefore {
      shortId
      versionId
    }
    restoredVersion {
      comment
      committedAt
      shortId
      versionId
    }
  }
}
    `;
export const RunWorkerTask_MutationDocument = `
    mutation runWorkerTask_mutation($payload: JSON, $projectId: String!, $taskType: String!, $workerName: String!) {
  runWorkerTask(
    payload: $payload
    projectId: $projectId
    taskType: $taskType
    workerName: $workerName
  ) {
    jobId
    project
    status
    statusUrl
    taskType
    workerName
  }
}
    `;
export const SendAgentMessage_MutationDocument = `
    mutation sendAgentMessage_mutation($input: AgentChatInput!) {
  sendAgentMessage(input: $input) {
    actions
    contextUsed
    meta
    summary
    warnings
    widgets
  }
}
    `;
export const UpdateWorkerRegistration_MutationDocument = `
    mutation updateWorkerRegistration_mutation($input: WorkerRegistrationInput!, $workerName: String!) {
  updateWorkerRegistration(input: $input, workerName: $workerName) {
    name
    status
    worker {
      name
      status
      tasks {
        agentInstructions
        description
        inputProperties
        inputRequired
        inputSchema
        inputSchemaVersion
        outputSchema
        payloadSchema
        summary
        type
      }
    }
  }
}
    `;
export const WritePaceFiles_MutationDocument = `
    mutation writePaceFiles_mutation($patches: [PaceFilePatchInput!], $projectId: String!, $writes: [PaceFileWriteInput!]) {
  writePaceFiles(patches: $patches, projectId: $projectId, writes: $writes) {
    changed {
      format
      kind
      path
    }
    project
    validation {
      issues {
        code
        field
        message
        path
        schemaPath
      }
      ok
    }
  }
}
    `;
export const AgentContext_QueryDocument = `
    query agentContext_query($input: AgentContextInput!) {
  agentContext(input: $input) {
    focus
  }
}
    `;
export const AssetUrl_QueryDocument = `
    query assetUrl_query($assetsUri: String!, $projectId: String!) {
  assetUrl(assetsUri: $assetsUri, projectId: $projectId) {
    assetsUri
    url
  }
}
    `;
export const ChatMessages_QueryDocument = `
    query chatMessages_query($threadId: String!) {
  chatMessages(threadId: $threadId) {
    contentJson
    contentText
    createdAt
    id
    projectId
    role
    status
    threadId
  }
}
    `;
export const ChatThread_QueryDocument = `
    query chatThread_query($threadId: String!) {
  chatThread(threadId: $threadId) {
    createdAt
    createdBy
    id
    projectId
    relatedJobId
    relatedPanelId
    relatedSceneId
    scope
    title
    updatedAt
  }
}
    `;
export const ChatThreads_QueryDocument = `
    query chatThreads_query($projectId: String!) {
  chatThreads(projectId: $projectId) {
    createdAt
    createdBy
    id
    projectId
    relatedJobId
    relatedPanelId
    relatedSceneId
    scope
    title
    updatedAt
  }
}
    `;
export const Job_QueryDocument = `
    query job_query($jobId: String!, $projectId: String!, $refresh: Boolean) {
  job(jobId: $jobId, projectId: $projectId, refresh: $refresh) {
    error
    eta
    filename
    jobId
    kind
    progress
    project
    renderUrl
    renderUrls
    result
    sceneCount
    seed
    status
  }
}
    `;
export const JobDebug_QueryDocument = `
    query jobDebug_query($jobId: String!, $refresh: Boolean = false) {
  jobDebug(jobId: $jobId, refresh: $refresh) {
    diagnostics
    job
    request
    result
    worker
    workerTask
  }
}
    `;
export const Jobs_QueryDocument = `
    query jobs_query($kind: String, $limit: Int = 100, $projectId: String!, $refresh: Boolean) {
  jobs(kind: $kind, limit: $limit, projectId: $projectId, refresh: $refresh) {
    error
    eta
    filename
    jobId
    kind
    progress
    project
    renderUrl
    renderUrls
    result
    sceneCount
    seed
    status
  }
}
    `;
export const PaceFile_QueryDocument = `
    query paceFile_query($path: String!, $projectId: String!) {
  paceFile(path: $path, projectId: $projectId) {
    format
    kind
    path
    project
    sizeBytes
    updatedAt
    value
  }
}
    `;
export const PaceFileIndex_QueryDocument = `
    query paceFileIndex_query($prefix: String!, $projectId: String!) {
  paceFileIndex(prefix: $prefix, projectId: $projectId) {
    format
    kind
    path
    project
    sizeBytes
    updatedAt
  }
}
    `;
export const PaceStandard_QueryDocument = `
    query paceStandard_query {
  paceStandard {
    registry
    schema
    vocab
  }
}
    `;
export const PaceStandardRegistry_QueryDocument = `
    query paceStandardRegistry_query($name: String) {
  paceStandardRegistry(name: $name)
}
    `;
export const PaceStandardSchema_QueryDocument = `
    query paceStandardSchema_query($name: String) {
  paceStandardSchema(name: $name)
}
    `;
export const PaceStandardVocab_QueryDocument = `
    query paceStandardVocab_query($name: String) {
  paceStandardVocab(name: $name)
}
    `;
export const Project_QueryDocument = `
    query project_query($id: String!) {
  project(id: $id) {
    id
    name
    source
    version {
      current
      dirty
      dirtyPathsCount
      shortId
    }
  }
}
    `;
export const ProjectTree_QueryDocument = `
    query projectTree_query($projectId: String!) {
  projectTree(projectId: $projectId) {
    panelCount
    project {
      id
      name
      source
      version {
        current
        dirty
        dirtyPathsCount
        shortId
      }
    }
    sceneCount
    scenes {
      heading
      panelCount
      sceneId
      shotCount
      shots {
        id
        paceReady
        panelCount
        sceneHeading
        sceneId
        sceneSummary
        shotDescriptionEn
        shotDescriptionZh
        versionStatus
      }
      summary
    }
    shotCount
  }
}
    `;
export const ProjectVersion_QueryDocument = `
    query projectVersion_query($projectId: String!) {
  projectVersion(projectId: $projectId) {
    dirty
    dirtyPaths
    dirtyPathsCount
    shortId
    versionId
  }
}
    `;
export const ProjectVersions_QueryDocument = `
    query projectVersions_query($limit: Int = 50, $projectId: String!) {
  projectVersions(limit: $limit, projectId: $projectId) {
    comment
    committedAt
    shortId
    versionId
  }
}
    `;
export const Projects_QueryDocument = `
    query projects_query {
  projects {
    id
    name
    source
    version {
      current
      dirty
      dirtyPathsCount
      shortId
    }
  }
}
    `;
export const ValidatePaceProject_QueryDocument = `
    query validatePaceProject_query($projectId: String!) {
  validatePaceProject(projectId: $projectId) {
    issues {
      code
      field
      message
      path
      schemaPath
    }
    ok
  }
}
    `;
export const Viewer_QueryDocument = `
    query viewer_query {
  viewer {
    displayName
    email
    id
    status
  }
}
    `;
export const Workers_QueryDocument = `
    query workers_query($verbose: Boolean = false) {
  workers(verbose: $verbose) {
    name
    status
    tasks {
      agentInstructions
      description
      inputProperties
      inputRequired
      inputSchema
      inputSchemaVersion
      outputSchema
      payloadSchema
      summary
      type
    }
  }
}
    `;

export type SdkFunctionWrapper = <T>(action: (requestHeaders?:Record<string, string>) => Promise<T>, operationName: string, operationType?: string, variables?: any) => Promise<T>;


const defaultWrapper: SdkFunctionWrapper = (action, _operationName, _operationType, _variables) => action();

export function getSdk(client: GraphQLClient, withWrapper: SdkFunctionWrapper = defaultWrapper) {
  return {
    addChatMessage_mutation(variables: AddChatMessage_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<AddChatMessage_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<AddChatMessage_MutationMutation>({ document: AddChatMessage_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'addChatMessage_mutation', 'mutation', variables);
    },
    cleanProjectWorktree_mutation(variables: CleanProjectWorktree_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CleanProjectWorktree_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CleanProjectWorktree_MutationMutation>({ document: CleanProjectWorktree_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'cleanProjectWorktree_mutation', 'mutation', variables);
    },
    commitProjectVersion_mutation(variables: CommitProjectVersion_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CommitProjectVersion_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CommitProjectVersion_MutationMutation>({ document: CommitProjectVersion_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'commitProjectVersion_mutation', 'mutation', variables);
    },
    createAssetUploadUrl_mutation(variables: CreateAssetUploadUrl_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CreateAssetUploadUrl_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CreateAssetUploadUrl_MutationMutation>({ document: CreateAssetUploadUrl_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'createAssetUploadUrl_mutation', 'mutation', variables);
    },
    createChatThread_mutation(variables: CreateChatThread_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CreateChatThread_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CreateChatThread_MutationMutation>({ document: CreateChatThread_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'createChatThread_mutation', 'mutation', variables);
    },
    createProject_mutation(variables: CreateProject_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<CreateProject_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<CreateProject_MutationMutation>({ document: CreateProject_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'createProject_mutation', 'mutation', variables);
    },
    deletePaceFiles_mutation(variables: DeletePaceFiles_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<DeletePaceFiles_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<DeletePaceFiles_MutationMutation>({ document: DeletePaceFiles_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'deletePaceFiles_mutation', 'mutation', variables);
    },
    deleteProject_mutation(variables: DeleteProject_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<DeleteProject_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<DeleteProject_MutationMutation>({ document: DeleteProject_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'deleteProject_mutation', 'mutation', variables);
    },
    deleteProjectVersion_mutation(variables: DeleteProjectVersion_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<DeleteProjectVersion_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<DeleteProjectVersion_MutationMutation>({ document: DeleteProjectVersion_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'deleteProjectVersion_mutation', 'mutation', variables);
    },
    heartbeatWorker_mutation(variables: HeartbeatWorker_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<HeartbeatWorker_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<HeartbeatWorker_MutationMutation>({ document: HeartbeatWorker_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'heartbeatWorker_mutation', 'mutation', variables);
    },
    login_mutation(variables: Login_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Login_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<Login_MutationMutation>({ document: Login_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'login_mutation', 'mutation', variables);
    },
    logout_mutation(variables?: Logout_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Logout_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<Logout_MutationMutation>({ document: Logout_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'logout_mutation', 'mutation', variables);
    },
    register_mutation(variables: Register_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Register_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<Register_MutationMutation>({ document: Register_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'register_mutation', 'mutation', variables);
    },
    registerWorker_mutation(variables: RegisterWorker_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<RegisterWorker_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<RegisterWorker_MutationMutation>({ document: RegisterWorker_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'registerWorker_mutation', 'mutation', variables);
    },
    restoreProjectVersion_mutation(variables: RestoreProjectVersion_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<RestoreProjectVersion_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<RestoreProjectVersion_MutationMutation>({ document: RestoreProjectVersion_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'restoreProjectVersion_mutation', 'mutation', variables);
    },
    runWorkerTask_mutation(variables: RunWorkerTask_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<RunWorkerTask_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<RunWorkerTask_MutationMutation>({ document: RunWorkerTask_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'runWorkerTask_mutation', 'mutation', variables);
    },
    sendAgentMessage_mutation(variables: SendAgentMessage_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<SendAgentMessage_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<SendAgentMessage_MutationMutation>({ document: SendAgentMessage_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'sendAgentMessage_mutation', 'mutation', variables);
    },
    updateWorkerRegistration_mutation(variables: UpdateWorkerRegistration_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<UpdateWorkerRegistration_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<UpdateWorkerRegistration_MutationMutation>({ document: UpdateWorkerRegistration_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'updateWorkerRegistration_mutation', 'mutation', variables);
    },
    writePaceFiles_mutation(variables: WritePaceFiles_MutationMutationVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<WritePaceFiles_MutationMutation> {
      return withWrapper((wrappedRequestHeaders) => client.request<WritePaceFiles_MutationMutation>({ document: WritePaceFiles_MutationDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'writePaceFiles_mutation', 'mutation', variables);
    },
    agentContext_query(variables: AgentContext_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<AgentContext_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<AgentContext_QueryQuery>({ document: AgentContext_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'agentContext_query', 'query', variables);
    },
    assetUrl_query(variables: AssetUrl_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<AssetUrl_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<AssetUrl_QueryQuery>({ document: AssetUrl_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'assetUrl_query', 'query', variables);
    },
    chatMessages_query(variables: ChatMessages_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ChatMessages_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ChatMessages_QueryQuery>({ document: ChatMessages_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'chatMessages_query', 'query', variables);
    },
    chatThread_query(variables: ChatThread_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ChatThread_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ChatThread_QueryQuery>({ document: ChatThread_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'chatThread_query', 'query', variables);
    },
    chatThreads_query(variables: ChatThreads_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ChatThreads_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ChatThreads_QueryQuery>({ document: ChatThreads_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'chatThreads_query', 'query', variables);
    },
    job_query(variables: Job_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Job_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Job_QueryQuery>({ document: Job_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'job_query', 'query', variables);
    },
    jobDebug_query(variables: JobDebug_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<JobDebug_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<JobDebug_QueryQuery>({ document: JobDebug_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'jobDebug_query', 'query', variables);
    },
    jobs_query(variables: Jobs_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Jobs_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Jobs_QueryQuery>({ document: Jobs_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'jobs_query', 'query', variables);
    },
    paceFile_query(variables: PaceFile_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<PaceFile_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<PaceFile_QueryQuery>({ document: PaceFile_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'paceFile_query', 'query', variables);
    },
    paceFileIndex_query(variables: PaceFileIndex_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<PaceFileIndex_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<PaceFileIndex_QueryQuery>({ document: PaceFileIndex_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'paceFileIndex_query', 'query', variables);
    },
    paceStandard_query(variables?: PaceStandard_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<PaceStandard_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<PaceStandard_QueryQuery>({ document: PaceStandard_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'paceStandard_query', 'query', variables);
    },
    paceStandardRegistry_query(variables?: PaceStandardRegistry_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<PaceStandardRegistry_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<PaceStandardRegistry_QueryQuery>({ document: PaceStandardRegistry_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'paceStandardRegistry_query', 'query', variables);
    },
    paceStandardSchema_query(variables?: PaceStandardSchema_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<PaceStandardSchema_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<PaceStandardSchema_QueryQuery>({ document: PaceStandardSchema_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'paceStandardSchema_query', 'query', variables);
    },
    paceStandardVocab_query(variables?: PaceStandardVocab_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<PaceStandardVocab_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<PaceStandardVocab_QueryQuery>({ document: PaceStandardVocab_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'paceStandardVocab_query', 'query', variables);
    },
    project_query(variables: Project_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Project_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Project_QueryQuery>({ document: Project_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'project_query', 'query', variables);
    },
    projectTree_query(variables: ProjectTree_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ProjectTree_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ProjectTree_QueryQuery>({ document: ProjectTree_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'projectTree_query', 'query', variables);
    },
    projectVersion_query(variables: ProjectVersion_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ProjectVersion_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ProjectVersion_QueryQuery>({ document: ProjectVersion_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'projectVersion_query', 'query', variables);
    },
    projectVersions_query(variables: ProjectVersions_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ProjectVersions_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ProjectVersions_QueryQuery>({ document: ProjectVersions_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'projectVersions_query', 'query', variables);
    },
    projects_query(variables?: Projects_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Projects_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Projects_QueryQuery>({ document: Projects_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'projects_query', 'query', variables);
    },
    validatePaceProject_query(variables: ValidatePaceProject_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ValidatePaceProject_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ValidatePaceProject_QueryQuery>({ document: ValidatePaceProject_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'validatePaceProject_query', 'query', variables);
    },
    viewer_query(variables?: Viewer_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Viewer_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Viewer_QueryQuery>({ document: Viewer_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'viewer_query', 'query', variables);
    },
    workers_query(variables?: Workers_QueryQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<Workers_QueryQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Workers_QueryQuery>({ document: Workers_QueryDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'workers_query', 'query', variables);
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;