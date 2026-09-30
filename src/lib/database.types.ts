export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
export interface Database {
  public: {
    Tables: {
      checks: { Row: { id: string; public_id: string; title: string; currency: 'UZS'; service_percent: number; owner_uid: string; status: string; created_at: string; updated_at: string }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] }
      participants: { Row: { id: string; check_id: string; user_id: string | null; name: string; sort_order: number; created_at: string }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] }
      items: { Row: { id: string; check_id: string; name: string; quantity: number; unit_price: number; created_by: string | null; created_at: string }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] }
      item_units: { Row: { id: string; item_id: string; unit_index: number }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] }
      item_shares: { Row: { id: string; item_unit_id: string; participant_id: string; amount: number; mode: 'equal' | 'by_quantity' | 'custom'; updated_at: string }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] }
      payments: { Row: { id: string; check_id: string; participant_id: string; amount_paid: number; proof_url: string | null; status: 'unpaid' | 'partially_paid' | 'proof_submitted' | 'paid'; confirmed_by: string | null; submitted_at: string | null; confirmed_at: string | null }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] }
      comments: { Row: { id: string; check_id: string; item_id: string | null; participant_id: string; body: string; created_at: string }; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] }
    }
    Views: Record<string, never>
    Functions: {
      create_check: { Args: { p_title: string; p_service_percent: number; p_owner_name: string; p_owner_token: string }; Returns: Json }
      join_check: { Args: { p_public_id: string; p_name: string; p_session_token: string }; Returns: Json }
      claim_check_owner: { Args: { p_public_id: string; p_owner_token: string }; Returns: string }
      add_item: { Args: { p_check_id: string; p_name: string; p_quantity: number; p_unit_price: number; p_creator_participant: string }; Returns: string }
      delete_item: { Args: { p_check_id: string; p_item_id: string }; Returns: undefined }
      toggle_unit_share: { Args: { p_item_unit: string; p_enabled: boolean }; Returns: undefined }
      set_unit_custom_shares: { Args: { p_item_unit: string; p_allocations: Json }; Returns: undefined }
      reset_unit_custom_shares: { Args: { p_item_unit: string }; Returns: undefined }
      submit_payment: { Args: { p_check_id: string; p_amount: number; p_proof_url: string | null }; Returns: undefined }
      confirm_payment: { Args: { p_check_id: string; p_participant_id: string }; Returns: undefined }
      add_comment: { Args: { p_check_id: string; p_item_id: string | null; p_body: string }; Returns: string }
      archive_check: { Args: { p_check_id: string }; Returns: undefined }
      delete_check: { Args: { p_check_id: string }; Returns: undefined }
      remove_participant: { Args: { p_check_id: string; p_participant_id: string }; Returns: undefined }
      delete_comment: { Args: { p_comment_id: string }; Returns: undefined }
    }
    Enums: { payment_status: 'unpaid' | 'partially_paid' | 'proof_submitted' | 'paid'; share_mode: 'equal' | 'by_quantity' | 'custom' }
    CompositeTypes: Record<string, never>
  }
}
