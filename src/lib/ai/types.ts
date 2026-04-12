export interface GenerationRequest {
  prompt: string
  negativePrompt?: string
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
  seed?: number
  model: string
}

export interface GenerationResult {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  outputUrl?: string
  metadata?: Record<string, unknown>
  error?: string
}

export interface AIProvider {
  name: string
  generateImage(req: GenerationRequest): Promise<GenerationResult>
  generateVideo?(req: GenerationRequest & { duration?: number }): Promise<GenerationResult>
  checkStatus(taskId: string): Promise<GenerationResult>
  getAvailableModels(): { id: string; name: string; type: 'image' | 'video' }[]
}

// ===== ビデオ生成関連の型 =====

export type VideoDuration = 'auto' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '18' | '20';
export type VideoResolution = '480p' | '720p' | '1080p' | '1440p' | '2160p';
export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' | 'auto';
export type VideoFps = 24 | 25 | 48 | 50;

export interface VideoGenerationRequest {
  prompt: string;
  duration?: VideoDuration;        // デフォルト: '6'
  resolution?: VideoResolution;    // デフォルト: '1080p'
  aspectRatio?: VideoAspectRatio;  // デフォルト: '16:9'
  fps?: VideoFps;                  // デフォルト: 25（50fpsは10秒以下のみ）
  seed?: number | null;
  audioEnabled?: boolean;          // デフォルト: true
  model: string;                   // フロントエンドID（例: 'ltx-2.3-fast'）
  mode?: 'text-to-video' | 'image-to-video' | 'video-to-video';
  imageUrl?: string;               // image-to-video / video-to-video 参照画像URL
  videoUrl?: string;               // video-to-video 用の入力動画URL
}

export interface VideoGenerationResult {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  fileName?: string;
  contentType?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type VideoGenerationProgress = {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
  logs?: string[];
};

// ビデオモデル定義
export interface VideoModelDefinition {
  id: string;                      // フロントエンドID（例: 'ltx-2.3-fast'）
  name: string;                    // 表示名
  endpoint: string;                // text-to-video エンドポイント
  i2vEndpoint?: string;            // image-to-video エンドポイント（省略時はendpointを使用）
  pricePerSecond: number;          // USD/秒
  maxDuration: VideoDuration;      // 最大秒数
  supportedDurations: string[];    // 選択可能な秒数リスト
  supportedResolutions: VideoResolution[];
  supportedAspectRatios: VideoAspectRatio[];
  i2vSupportedAspectRatios?: VideoAspectRatio[]; // i2v時のアスペクト比（省略時はsupportedAspectRatiosを使用）
  features: string[];              // 例: ['audio', '4k']
  paramStyle: 'ltx' | 'kling' | 'kling-v2v' | 'seedance' | 'seedance-r2v';    // API パラメータの組み立て方式
  supportedModes: ('text-to-video' | 'image-to-video' | 'video-to-video')[];
  supportedFps?: number[];           // 例: [24, 25, 48, 50]（省略時はfps設定不可）
}

// AIProvider インターフェースにビデオメソッドを追加するための型
export interface VideoProvider {
  name: string;
  generateVideo(
    request: VideoGenerationRequest,
    onProgress?: (progress: VideoGenerationProgress) => void,
    onRequestId?: (requestId: string, endpoint: string) => void
  ): Promise<VideoGenerationResult>;
  recoverVideo(
    requestId: string,
    endpoint: string,
    onProgress?: (progress: VideoGenerationProgress) => void
  ): Promise<VideoGenerationResult>;
  getAvailableVideoModels(): VideoModelDefinition[];
}
