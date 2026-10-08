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
  IDeleteImagePayload,
  IPresignImageUploadPayload,
  IPresignImageUploadResponse,
} from "./upload.interface.js";

// =====================================================
// CONSTANTS
// =====================================================

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const PRESIGNED_UPLOAD_EXPIRY_SECONDS = 300;

const SIGNED_GET_EXPIRY_SECONDS = 3600;

const ALLOWED_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
// FOLDER -> PURPOSE
// =====================================================

const getPurposeFromFolder = (folder: string): ImagePurpose => {
  switch (folder) {
    case "users":
      return "USER_AVATAR";

    case "brands":
      return "BRAND_LOGO";

    case "branches":
      return "BRANCH_IMAGE";

    case "services":
      return "SERVICE_IMAGE";

    case "packages":
      return "PACKAGE_IMAGE";

    case "staff":
      return "STAFF_IMAGE";

    case "reviews":
      return "REVIEW_IMAGE";

    case "promotions":
      return "PROMOTION_IMAGE";

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
// STRICT OBJECT KEY PARSER
// =====================================================

const parseObjectKey = (objectKey: string) => {
  const parts = objectKey.split("/");

  if (parts.length !== 3) {
    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  const [folder, entityId, fileName] = parts;

  if (!folder || !entityId || !fileName) {
    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  if (fileName.includes("/") || fileName === "." || fileName === "..") {
    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  return {
    folder,
    entityId,
    fileName,
  };
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
  // Any authenticated user can manage own avatar.
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
  // CUSTOMER can manage only own review images.
  // entityId = customer userId
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
// CHECK IF IMAGE IS STILL REFERENCED BY DATABASE
//
// Public delete endpoint must not be able to delete an
// image that an entity is actively using.
//
// Replacement/delete flows should first update/delete
// the database reference and then remove the old object.
// =====================================================

const isImageReferenced = async (objectKey: string): Promise<boolean> => {
  const [
    user,
    brand,
    branch,
    staff,
    promotion,
    serviceImage,
    packageImage,
    reviewImage,
  ] = await Promise.all([
    prisma.user.findFirst({
      where: {
        avatarObjectKey: objectKey,
      },

      select: {
        id: true,
      },
    }),

    prisma.brand.findFirst({
      where: {
        logoObjectKey: objectKey,
      },

      select: {
        id: true,
      },
    }),

    prisma.branch.findFirst({
      where: {
        imageObjectKey: objectKey,
      },

      select: {
        id: true,
      },
    }),

    prisma.staff.findFirst({
      where: {
        avatarObjectKey: objectKey,
      },

      select: {
        id: true,
      },
    }),

    prisma.promotion.findFirst({
      where: {
        imageObjectKey: objectKey,
      },

      select: {
        id: true,
      },
    }),

    prisma.serviceImage.findFirst({
      where: {
        objectKey,
      },

      select: {
        id: true,
      },
    }),

    prisma.packageImage.findFirst({
      where: {
        objectKey,
      },

      select: {
        id: true,
      },
    }),

    prisma.reviewImage.findFirst({
      where: {
        objectKey,
      },

      select: {
        id: true,
      },
    }),
  ]);

  return Boolean(
    user ||
    brand ||
    branch ||
    staff ||
    promotion ||
    serviceImage ||
    packageImage ||
    reviewImage,
  );
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
  // 2. DEFENSE-IN-DEPTH SIZE CHECK
  //
  // Zod already performs this check.
  // Service keeps it too in case called elsewhere.
  // ===================================================

  if (payload.fileSize <= 0 || payload.fileSize > MAX_IMAGE_SIZE_BYTES) {
    throw new AppError("IMAGE_TOO_LARGE", 400);
  }

  // ===================================================
  // 3. DETERMINE FOLDER / EXTENSION
  // ===================================================

  const folder = getPurposeFolder(payload.purpose);

  const extension = getFileExtension(payload.contentType);

  // ===================================================
  // 4. GENERATE RANDOM OBJECT KEY
  // ===================================================

  const fileId = crypto.randomUUID();

  const objectKey = `${folder}/${payload.entityId}/${fileId}.${extension}`;

  // ===================================================
  // 5. CREATE PUT COMMAND
  // ===================================================

  const command = new PutObjectCommand({
    Bucket: config.r2.bucketName,

    Key: objectKey,

    ContentType: payload.contentType,
  });

  // ===================================================
  // 6. SIGN PUT URL
  // ===================================================

  const uploadUrl = await getSignedUrl(r2Client, command, {
    expiresIn: PRESIGNED_UPLOAD_EXPIRY_SECONDS,
  });

  return {
    uploadUrl,
    objectKey,

    expiresInSeconds: PRESIGNED_UPLOAD_EXPIRY_SECONDS,
  };
};

// =====================================================
// VERIFY IMAGE EXISTS
// =====================================================

const verifyImageExists = async (objectKey: string): Promise<void> => {
  try {
    const command = new HeadObjectCommand({
      Bucket: config.r2.bucketName,

      Key: objectKey,
    });

    const object = await r2Client.send(command);

    // =================================================
    // 1. CONTENT TYPE
    // =================================================

    if (
      !object.ContentType ||
      !ALLOWED_IMAGE_CONTENT_TYPES.includes(object.ContentType)
    ) {
      throw new AppError("INVALID_IMAGE_TYPE", 400);
    }

    // =================================================
    // 2. ACTUAL FILE SIZE
    // =================================================

    if (typeof object.ContentLength !== "number" || object.ContentLength <= 0) {
      throw new AppError("INVALID_IMAGE_SIZE", 400);
    }

    if (object.ContentLength > MAX_IMAGE_SIZE_BYTES) {
      throw new AppError("IMAGE_TOO_LARGE", 400);
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("UPLOADED_IMAGE_NOT_FOUND", 404);
  }
};

// =====================================================
// CONFIRM IMAGE UPLOAD
// =====================================================

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
  // 2. STRICT KEY STRUCTURE
  // ===================================================

  const { folder, entityId } = parseObjectKey(payload.objectKey);

  const derivedPurpose = getPurposeFromFolder(folder);

  if (derivedPurpose !== payload.purpose || entityId !== payload.entityId) {
    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  // ===================================================
  // 3. EXPECTED PREFIX
  // ===================================================

  const expectedPrefix = getExpectedObjectPrefix(
    payload.purpose,
    payload.entityId,
  );

  if (!payload.objectKey.startsWith(expectedPrefix)) {
    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  // ===================================================
  // 4. VERIFY OBJECT
  // ===================================================

  await verifyImageExists(payload.objectKey);

  // ===================================================
  // 5. GENERATE SIGNED GET URL
  // ===================================================

  const getCommand = new GetObjectCommand({
    Bucket: config.r2.bucketName,

    Key: payload.objectKey,
  });

  const url = await getSignedUrl(r2Client, getCommand, {
    expiresIn: SIGNED_GET_EXPIRY_SECONDS,
  });

  return {
    objectKey: payload.objectKey,

    url,
  };
};

// =====================================================
// DELETE IMAGE
// =====================================================

const deleteImage = async (
  payload: IDeleteImagePayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  // ===================================================
  // 1. PARSE STRICT OBJECT KEY
  // ===================================================

  const { folder, entityId } = parseObjectKey(payload.objectKey);

  // ===================================================
  // 2. DERIVE PURPOSE
  // ===================================================

  const purpose = getPurposeFromFolder(folder);

  // ===================================================
  // 3. AUTHORIZATION
  // ===================================================

  await validateImageUploadAccess(purpose, entityId, requester);

  // ===================================================
  // 4. VERIFY EXPECTED PREFIX
  // ===================================================

  const expectedPrefix = getExpectedObjectPrefix(purpose, entityId);

  if (!payload.objectKey.startsWith(expectedPrefix)) {
    throw new AppError("UPLOAD_NOT_ALLOWED", 403);
  }

  // ===================================================
  // 5. PREVENT DELETING ACTIVE DB REFERENCES
  // ===================================================

  const referenced = await isImageReferenced(payload.objectKey);

  if (referenced) {
    throw new AppError("IMAGE_STILL_IN_USE", 409);
  }

  // ===================================================
  // 6. VERIFY OBJECT EXISTS / TYPE / SIZE
  // ===================================================

  await verifyImageExists(payload.objectKey);

  // ===================================================
  // 7. DELETE FROM R2
  // ===================================================

  const deleteCommand = new DeleteObjectCommand({
    Bucket: config.r2.bucketName,

    Key: payload.objectKey,
  });

  await r2Client.send(deleteCommand);

  return null;
};

// =====================================================
// GET SIGNED IMAGE URL
// =====================================================

const getImageUrl = async (objectKey: string): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: config.r2.bucketName,

    Key: objectKey,
  });

  return await getSignedUrl(r2Client, command, {
    expiresIn: SIGNED_GET_EXPIRY_SECONDS,
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
