export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
// Clients read checks only through get_check and change them only through these RPCs.
export interface Database {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      get_check: { Args: { p_public_id: string }; Returns: Json }
      check_preview: { Args: { p_public_id: string }; Returns: Json }
      touch_account: { Args: Record<string, never>; Returns: undefined }
      create_check: { Args: { p_title: string; p_service_percent: number; p_owner_name: string; p_owner_token: string; p_payment_details: string | null; p_expected_guests?: number | null }; Returns: Json }
      join_check: { Args: { p_public_id: string; p_name: string; p_session_token: string }; Returns: Json }
      claim_check_owner: { Args: { p_public_id: string; p_owner_token: string }; Returns: string }
      add_item: { Args: { p_check_id: string; p_name: string; p_quantity: number; p_unit_price: number }; Returns: string }
      add_items: { Args: { p_check_id: string; p_items: { name: string; quantity: number; unit_price: number }[] }; Returns: string[] }
      update_item: { Args: { p_check_id: string; p_item_id: string; p_name: string; p_quantity: number; p_unit_price: number }; Returns: undefined }
      update_check: { Args: { p_check_id: string; p_title: string; p_service_percent: number; p_payment_details: string; p_expected_guests?: number | null }; Returns: undefined }
      share_item_equally: { Args: { p_check_id: string; p_item_id: string }; Returns: undefined }
      unshare_item: { Args: { p_check_id: string; p_item_id: string }; Returns: undefined }
      unconfirm_payment: { Args: { p_check_id: string; p_participant_id: string }; Returns: undefined }
      delete_item: { Args: { p_check_id: string; p_item_id: string }; Returns: undefined }
      toggle_unit_share: { Args: { p_item_unit: string; p_enabled: boolean }; Returns: undefined }
      set_unit_custom_shares: { Args: { p_item_unit: string; p_allocations: Json }; Returns: undefined }
      reset_unit_custom_shares: { Args: { p_item_unit: string }; Returns: undefined }
      submit_payment: { Args: { p_check_id: string; p_amount: number }; Returns: undefined }
      confirm_payment: { Args: { p_check_id: string; p_participant_id: string }; Returns: undefined }
      add_comment: { Args: { p_check_id: string; p_item_id: string | null; p_body: string }; Returns: string }
      delete_comment: { Args: { p_comment_id: string }; Returns: undefined }
      remove_participant: { Args: { p_check_id: string; p_participant_id: string }; Returns: undefined }
      delete_check: { Args: { p_check_id: string }; Returns: undefined }
    }
    Enums: { payment_status: 'unpaid' | 'partially_paid' | 'proof_submitted' | 'paid'; share_mode: 'equal' | 'by_quantity' | 'custom' }
    CompositeTypes: Record<string, never>
  }
}
