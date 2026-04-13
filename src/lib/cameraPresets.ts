export interface CameraPreset {
  id: string
  label: string
  prompt: string
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'front',        label: 'フロント',    prompt: 'front view, full body shot' },
  { id: 'back',         label: 'バック',      prompt: 'back view, full body shot' },
  { id: 'side-left',    label: 'サイド左',    prompt: 'left side view, full body shot' },
  { id: 'side-right',   label: 'サイド右',    prompt: 'right side view, full body shot' },
  { id: '3q-front-l',   label: '斜め前左',    prompt: 'three-quarter front left view, full body shot' },
  { id: '3q-front-r',   label: '斜め前右',    prompt: 'three-quarter front right view, full body shot' },
  { id: '3q-back-l',    label: '斜め後ろ左',  prompt: 'three-quarter back left view, full body shot' },
  { id: '3q-back-r',    label: '斜め後ろ右',  prompt: 'three-quarter back right view, full body shot' },
  { id: 'upper-body',   label: '上半身',      prompt: 'upper body shot, front view' },
  { id: 'lower-body',   label: '下半身',      prompt: 'lower body shot, front view' },
]
