export interface IUpdateProfilePayload {
  name?: string;
  phone?: string;
  avatarObjectKey?: string;
}

export interface IChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}
