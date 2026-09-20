export interface IUpdateProfilePayload {
  name?: string;
  phone?: string;
}
export interface IChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}
