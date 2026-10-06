import crypto from "crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { Role } from "../../../../generated/prisma/client.js";

import config from "../../config/index.js";
import { prisma } from "../../lib/prisma.js";
import { r2Client } from "../../lib/r2.js";

import { AppError } from "../../utils/app-error.js";

import {
  ImagePurpose,
  IConfirmImageUploadPayload,
  IConfirmImageUploadResponse,
  IPresignImageUploadPayload,
  IPresignImageUploadResponse,
  IDeleteImagePayload,
} from "./upload.interface.js";

// =====================================================
// PURPOSE -> FOLDER
// =====================================================

const getPurposeFolder = (purpose: ImagePurpose): string => {
  switch (purpose) {
    case "USER_AVATAR":
      return "users";

    case "BRAND_LOGO":
      return "brands";

    case "BRANCH_IMAGE":
      return "branches";

    case "SERVICE_IMAGE":
      return "services";

    case "PACKAGE_IMAGE":
      return "packages";

    case "STAFF_IMAGE":
      return "staff";

    case "REVIEW_IMAGE":
      return "reviews";

    case "PROMOTION_IMAGE":
      return "promotions";

    default:
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }
};

// =====================================================
// EXPECTED OBJECT PREFIX
// =====================================================

const getExpectedObjectPrefix = (
  purpose: ImagePurpose,
  entityId: string,
): string => {
  const folder = getPurposeFolder(purpose);

  return `${folder}/${entityId}/`;
};

// =====================================================
// CONTENT TYPE -> EXTENSION
// =====================================================

const getFileExtension = (contentType: string): string => {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";

    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    default:
      throw new AppError("INVALID_IMAGE_TYPE", 400);
  }
};

// =====================================================
// PURPOSE / ENTITY / ROLE AUTHORIZATION
// =====================================================

const validateImageUploadAccess = async (
  purpose: ImagePurpose,
  entityId: string,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  // ===================================================
  // USER_AVATAR
  // Any authenticated user can upload own avatar.
  // ===================================================

  if (purpose === "USER_AVATAR") {
    if (entityId !== requester.userId) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    return;
  }

  // ===================================================
  // BRAND_LOGO
  // BRAND_OWNER only
  // ===================================================

  if (purpose === "BRAND_LOGO") {
    if (requester.role !== Role.BRAND_OWNER) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    const brand = await prisma.brand.findUnique({
      where: {
        id: entityId,
      },

      select: {
        id: true,
      },
    });

    if (!brand) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    return;
  }

  // ===================================================
  // BRANCH_IMAGE
  // BRAND_OWNER or assigned BRANCH_MANAGER
  // ===================================================

  if (purpose === "BRANCH_IMAGE") {
    const branch = await prisma.branch.findUnique({
      where: {
        id: entityId,
      },

      select: {
        id: true,
      },
    });

    if (!branch) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    if (requester.role === Role.BRAND_OWNER) {
      return;
    }

    if (requester.role === Role.BRANCH_MANAGER) {
      const managerBranch = await prisma.branchManagerBranch.findUnique({
        where: {
          userId_branchId: {
            userId: requester.userId,

            branchId: entityId,
          },
        },

        select: {
          userId: true,
        },
      });

      if (managerBranch) {
        return;
      }
    }

    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  // ===================================================
  // SERVICE_IMAGE
  // BRAND_OWNER only
  // ===================================================

  if (purpose === "SERVICE_IMAGE") {
    if (requester.role !== Role.BRAND_OWNER) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    const service = await prisma.service.findUnique({
      where: {
        id: entityId,
      },

      select: {
        id: true,
      },
    });

    if (!service) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    return;
  }

  // ===================================================
  // PACKAGE_IMAGE
  // BRAND_OWNER only
  // ===================================================

  if (purpose === "PACKAGE_IMAGE") {
    if (requester.role !== Role.BRAND_OWNER) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    const packageData = await prisma.package.findUnique({
      where: {
        id: entityId,
      },

      select: {
        id: true,
      },
    });

    if (!packageData) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    return;
  }

  // ===================================================
  // STAFF_IMAGE
  // BRAND_OWNER or manager of staff branch
  // ===================================================

  if (purpose === "STAFF_IMAGE") {
    const staff = await prisma.staff.findUnique({
      where: {
        id: entityId,
      },

      select: {
        id: true,

        branches: {
          select: {
            branchId: true,
          },
        },
      },
    });

    if (!staff) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    if (requester.role === Role.BRAND_OWNER) {
      return;
    }

    if (requester.role === Role.BRANCH_MANAGER) {
      const managerBranches = await prisma.branchManagerBranch.findMany({
        where: {
          userId: requester.userId,
        },

        select: {
          branchId: true,
        },
      });

      const allowedBranchIds = new Set(
        managerBranches.map((item) => item.branchId),
      );

      const hasAccess = staff.branches.some((item) =>
        allowedBranchIds.has(item.branchId),
      );

      if (hasAccess) {
        return;
      }
    }

    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  // ===================================================
  // REVIEW_IMAGE
  // CUSTOMER can upload only for themselves.
  //
  // Review images are uploaded before review creation.
  // Therefore entityId = customer userId.
  // ===================================================

  if (purpose === "REVIEW_IMAGE") {
    if (requester.role !== Role.CUSTOMER || entityId !== requester.userId) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    return;
  }

  // ===================================================
  // PROMOTION_IMAGE
  // BRAND_OWNER only
  // ===================================================

  if (purpose === "PROMOTION_IMAGE") {
    if (requester.role !== Role.BRAND_OWNER) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    const promotion = await prisma.promotion.findUnique({
      where: {
        id: entityId,
      },

      select: {
        id: true,
      },
    });

    if (!promotion) {
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
    }

    return;
  }

  throw new AppError("UPLOAD_NOT_ALLOWED", 403);
};

// =====================================================
// PRESIGN IMAGE UPLOAD
// =====================================================

const presignImageUpload = async (
  payload: IPresignImageUploadPayload,

  requester: {
    userId: string;
    role: Role;
  },
): Promise<IPresignImageUploadResponse> => {
  // ===================================================
  // 1. AUTHORIZATION
  // ===================================================

  await validateImageUploadAccess(payload.purpose, payload.entityId, requester);

  // ===================================================
  // 2. DETERMINE FOLDER
  // ===================================================

  const folder = getPurposeFolder(payload.purpose);

  // ===================================================
  // 3. DETERMINE FILE EXTENSION
  // ===================================================

  const extension = getFileExtension(payload.contentType);

  // ===================================================
  // 4. GENERATE OBJECT KEY
  // ===================================================

  const fileId = crypto.randomUUID();

  const objectKey = `${folder}/${payload.entityId}/${fileId}.${extension}`;

  // ===================================================
  // 5. CREATE R2 PUT COMMAND
  // ===================================================

  const command = new PutObjectCommand({
    Bucket: config.r2.bucketName,

    Key: objectKey,

    ContentType: payload.contentType,
  });

  // ===================================================
  // 6. PRESIGNED URL EXPIRY
  // ===================================================

  const expiresInSeconds = 300;

  // ===================================================
  // 7. GENERATE PRESIGNED URL
  // ===================================================

  const uploadUrl = await getSignedUrl(r2Client, command, {
    expiresIn: expiresInSeconds,
  });

  // ===================================================
  // 8. RESPONSE
  // ===================================================

  return {
    uploadUrl,
    objectKey,
    expiresInSeconds,
  };
};

// =====================================================
// CONFIRM IMAGE UPLOAD
// =====================================================
const verifyImageExists = async (objectKey: string): Promise<void> => {
  try {
    const command = new HeadObjectCommand({
      Bucket: config.r2.bucketName,
      Key: objectKey,
    });

    const object = await r2Client.send(command);

    if (
      object.ContentType &&
      !["image/jpeg", "image/png", "image/webp"].includes(object.ContentType)
    ) {
      throw new AppError("INVALID_IMAGE_TYPE", 400);
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("UPLOADED_IMAGE_NOT_FOUND", 404);
  }
};

const confirmImageUpload = async (
  payload: IConfirmImageUploadPayload,

  requester: {
    userId: string;
    role: Role;
  },
): Promise<IConfirmImageUploadResponse> => {
  // ===================================================
  // 1. AUTHORIZATION
  // ===================================================

  await validateImageUploadAccess(payload.purpose, payload.entityId, requester);

  // ===================================================
  // 2. VERIFY OBJECT KEY BELONGS TO PURPOSE / ENTITY
  // ===================================================

  const expectedPrefix = getExpectedObjectPrefix(
    payload.purpose,
    payload.entityId,
  );

  if (!payload.objectKey.startsWith(expectedPrefix)) {
    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  // ===================================================
  // 3. VERIFY OBJECT ACTUALLY EXISTS IN R2
  // ===================================================

  await verifyImageExists(payload.objectKey);

  // ===================================================
  // 4. GENERATE TEMPORARY SIGNED GET URL
  // Private R2 bucket
  // ===================================================

  const getCommand = new GetObjectCommand({
    Bucket: config.r2.bucketName,

    Key: payload.objectKey,
  });

  const url = await getSignedUrl(r2Client, getCommand, {
    expiresIn: 3600,
  });

  // ===================================================
  // 5. RESPONSE
  // ===================================================

  return {
    objectKey: payload.objectKey,

    url,
  };
};
const deleteImage = async (
  payload: IDeleteImagePayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  // ===================================================
  // 1. DERIVE PURPOSE + ENTITY FROM OBJECT KEY
  // ===================================================

  const parts = payload.objectKey.split("/");

  if (parts.length < 3) {
    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  const folder = parts[0];
  const entityId = parts[1];

  let purpose: ImagePurpose;

  switch (folder) {
    case "users":
      purpose = "USER_AVATAR";
      break;

    case "brands":
      purpose = "BRAND_LOGO";
      break;

    case "branches":
      purpose = "BRANCH_IMAGE";
      break;

    case "services":
      purpose = "SERVICE_IMAGE";
      break;

    case "packages":
      purpose = "PACKAGE_IMAGE";
      break;

    case "staff":
      purpose = "STAFF_IMAGE";
      break;

    case "reviews":
      purpose = "REVIEW_IMAGE";
      break;

    case "promotions":
      purpose = "PROMOTION_IMAGE";
      break;

    default:
      throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  // ===================================================
  // 2. AUTHORIZATION
  // ===================================================

  await validateImageUploadAccess(purpose, entityId, requester);

  // ===================================================
  // 3. VERIFY OBJECT EXISTS
  // ===================================================

  try {
    const headCommand = new HeadObjectCommand({
      Bucket: config.r2.bucketName,

      Key: payload.objectKey,
    });

    await r2Client.send(headCommand);
  } catch {
    throw new AppError("UPLOADED_IMAGE_NOT_FOUND", 404);
  }

  // ===================================================
  // 4. DELETE OBJECT
  // ===================================================

  const deleteCommand = new DeleteObjectCommand({
    Bucket: config.r2.bucketName,

    Key: payload.objectKey,
  });

  await r2Client.send(deleteCommand);

  return null;
};

const getImageUrl = async (objectKey: string): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: objectKey,
  });

  return await getSignedUrl(r2Client, command, {
    expiresIn: 3600,
  });
};

// =====================================================
// EXPORT
// =====================================================

export const uploadService = {
  presignImageUpload,
  verifyImageExists,
  confirmImageUpload,
  deleteImage,
  getImageUrl,
};
