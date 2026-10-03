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
          team_edit: boolean
          canvas_version: number
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
          team_edit?: boolean
          canvas_version?: number
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
          team_edit?: boolean
          canvas_version?: number
          thumbnail_url?: string | null
          updated_at?: string
        }
      }
      workflow_edit_locks: {
        Row: {
          workflow_id: string
          user_id: string
          user_email: string | null
          session_id: string
          acquired_at: string
          heartbeat_at: string
        }
        Insert: {
          workflow_id: string
          user_id: string
          user_email?: string | null
          session_id: string
          acquired_at?: string
          heartbeat_at?: string
        }
        Update: {
          user_email?: string | null
          session_id?: string
          heartbeat_at?: string
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
          daily_item_limit: number
          show_cost: boolean
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
          display_name: string | null
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
      can_edit_workflow: {
        Args: { p_workflow_id: string }
        Returns: boolean
      }
      acquire_workflow_edit_lock: {
        Args: { p_workflow_id: string; p_session_id: string; p_heartbeat?: boolean }
        Returns: Json
      }
      release_workflow_edit_lock: {
        Args: { p_workflow_id: string; p_session_id: string }
        Returns: boolean
      }
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
