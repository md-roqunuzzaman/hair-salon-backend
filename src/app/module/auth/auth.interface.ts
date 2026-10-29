export interface IRegisterUserPayload {
  name: string;
  email: string;
  phone?: string;
  password: string;
}

export interface ILoginUserPayload {
  email: string;
  password: string;
}

export interface IForgotPasswordPayload {
  email: string;
  brandId?: string;
}

export interface IVerifyResetOtpPayload {
  email: string;
  brandId?: string;
  otp: string;
}

export interface IResetPasswordPayload {
  resetToken: string;
  newPassword: string;
}
