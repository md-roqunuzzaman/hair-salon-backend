export type ImagePurpose =
  | "USER_AVATAR"
  | "BRAND_LOGO"
  | "BRANCH_IMAGE"
  | "SERVICE_IMAGE"
  | "PACKAGE_IMAGE"
  | "STAFF_IMAGE"
  | "REVIEW_IMAGE"
  | "PROMOTION_IMAGE";

export interface IPresignImageUploadPayload {
  fileName: string;

  contentType: string;

  fileSize: number;

  purpose: ImagePurpose;

  entityId: string;
}

export interface IPresignImageUploadResponse {
  uploadUrl: string;

  objectKey: string;

  expiresInSeconds: number;
}

export interface IConfirmImageUploadPayload {
  objectKey: string;
  purpose: ImagePurpose;
  entityId: string;
}

export interface IConfirmImageUploadResponse {
  objectKey: string;
  url: string;
}

export interface IDeleteImagePayload {
  objectKey: string;
}
