import type { AccountStatus, Role } from "@latex-renderer/contracts";

export interface Page<Item> {
  items: Item[];
  nextCursor?: string | null;
}

export interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  role: Role;
  status: AccountStatus;
  last_login_at: string | null;
  identities?: { id: string; provider: string }[] | null;
  credential: { login_name: string } | null;
}

export interface ServiceAccountRow {
  id: string;
  name: string;
  status: AccountStatus;
  client_type: string;
  owner_user_id: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  service_account_id: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
