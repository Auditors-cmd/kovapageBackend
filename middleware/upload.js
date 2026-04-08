const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');
const path = require('path');

const profilePhotoStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const userId = req.user?.id || 'new';

    return {
      folder: 'kovapage/profiles',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      public_id: `user-${userId}-${Date.now()}`,
      transformation: [
        { width: 400, height: 400, crop: 'limit', quality: 'auto' },
        { fetch_format: 'auto' }
      ],
      resource_type: 'image'
    };
  }
});

const riskDataStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const userId = req.user?.id || 'system';

    return {
      folder: 'kovapage/risk-data',
      public_id: `risk-${userId}-${Date.now()}`,
      resource_type: 'raw'
    };
  }
});

const auditeeDocumentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const userId = req.user?.id || 'auditee';
    const requestId = req.params?.id || 'request';

    return {
      folder: 'kovapage/auditee-documents',
      public_id: `document-request-${requestId}-${userId}-${Date.now()}`,
      resource_type: 'raw'
    };
  }
});

const auditMethodologyStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const userId = req.user?.id || 'team-lead';
    const planId = req.params?.id || 'audit-plan';

    return {
      folder: 'kovapage/audit-methodology',
      public_id: `audit-methodology-${planId}-${userId}-${Date.now()}`,
      resource_type: 'raw'
    };
  }
});

const fileFilter = (req, file, cb) => {
  const extname = path.extname(file.originalname).toLowerCase();

  if (file.fieldname === 'profilePhoto') {
    const allowedImageTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

    if (allowedImageTypes.includes(extname) || allowedMimeTypes.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only image files are allowed for profile photos (jpeg, jpg, png, gif, webp)'));
  }

  if (file.fieldname === 'riskFile') {
    const allowedRiskExts = ['.xlsx', '.xls', '.csv', '.json'];
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/json'
    ];

    if (allowedRiskExts.includes(extname) || allowedMimeTypes.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only Excel, CSV, and JSON files are allowed for risk data'));
  }

  if (file.fieldname === 'documentFile') {
    const allowedDocumentExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.jpg', '.jpeg', '.png'];
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/jpg',
      'image/png'
    ];

    if (allowedDocumentExts.includes(extname) || allowedMimeTypes.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only PDF, Office documents, CSV, and common image files are allowed for auditee document uploads'));
  }

  return cb(new Error('Invalid file field. Use "profilePhoto", "riskFile", or "documentFile"'));
};

const uploadProfilePhoto = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

const uploadRiskData = multer({
  storage: riskDataStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

const uploadAuditeeDocument = multer({
  storage: auditeeDocumentStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: fileFilter
});

const uploadAuditMethodologyDocument = multer({
  storage: auditMethodologyStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: fileFilter
});

const upload = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

const deleteFromCloudinary = async (publicId) => {
  try {
    if (!publicId) return null;

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' }).catch(async () => {
      return cloudinary.uploader.destroy(publicId);
    });
    console.log(`Deleted from Cloudinary: ${publicId}`, result);
    return result;
  } catch (error) {
    console.error(`Error deleting from Cloudinary: ${publicId}`, error);
    throw error;
  }
};

module.exports = {
  uploadProfilePhoto,
  uploadRiskData,
  uploadAuditeeDocument,
  uploadAuditMethodologyDocument,
  upload,
  deleteFromCloudinary
};
