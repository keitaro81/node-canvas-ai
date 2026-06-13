export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string
          name: string
          description: string | null
          thumbnail_url: string | null
          user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          thumbnail_url?: string | null
          user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          thumbnail_url?: string | null
          user_id?: string | null
          updated_at?: string
        }
      }
      workflows: {
        Row: {
          id: string
          project_id: string
          name: string
          canvas_data: Json | null
          viewport: Json | null
          is_template: boolean
          is_public: boolean
          thumbnail_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          name: string
          canvas_data?: Json | null
          viewport?: Json | null
          is_template?: boolean
          is_public?: boolean
          thumbnail_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          name?: string
          canvas_data?: Json | null
          viewport?: Json | null
          is_template?: boolean
          is_public?: boolean
          thumbnail_url?: string | null
          updated_at?: string
        }
      }
      generations: {
        Row: {
          id: string
          workflow_id: string
          node_id: string
          node_type: string | null
          input_params: Json | null
          output_url: string | null
          output_metadata: Json | null
          status: string
          error_message: string | null
          credits_used: number | null
          provider: string | null
          external_task_id: string | null
          created_at: string
          completed_at: string | null
          user_id: string | null
          team_id: string | null
        }
        Insert: {
          id?: string
          workflow_id: string
          node_id: string
          node_type?: string | null
          input_params?: Json | null
          output_url?: string | null
          output_metadata?: Json | null
          status?: string
          error_message?: string | null
          credits_used?: number | null
          provider?: string | null
          external_task_id?: string | null
          created_at?: string
          completed_at?: string | null
          user_id?: string | null
          team_id?: string | null
        }
        Update: {
          id?: string
          status?: string
          output_url?: string | null
          output_metadata?: Json | null
          error_message?: string | null
          credits_used?: number | null
          completed_at?: string | null
          team_id?: string | null
        }
      }
      teams: {
        Row: {
          id: string
          name: string
          quota_image_monthly: number
          quota_video_monthly: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          quota_image_monthly?: number
          quota_video_monthly?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          quota_image_monthly?: number
          quota_video_monthly?: number
        }
      }
      team_members: {
        Row: {
          team_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          team_id: string
          user_id: string
          role?: string
          created_at?: string
        }
        Update: {
          role?: string
        }
      }
      usage_counters: {
        Row: {
          team_id: string
          user_id: string
          period: string
          kind: string
          count: number
        }
        Insert: {
          team_id: string
          user_id: string
          period: string
          kind: string
          count?: number
        }
        Update: {
          count?: number
        }
      }
      api_keys: {
        Row: {
          id: string
          user_id: string
          provider: string
          encrypted_key: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          encrypted_key: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          encrypted_key?: string
          updated_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: {
      increment_usage_counter: {
        Args: {
          p_team_id: string
          p_user_id: string
          p_period: string
          p_kind: string
        }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
  }
}
