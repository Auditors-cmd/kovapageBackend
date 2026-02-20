const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');
const path = require('path');

// =====================================================
// CLOUDINARY STORAGE FOR PROFILE PHOTOS
// =====================================================
const profilePhotoStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Get file extension
    const ext = path.extname(file.originalname).toLowerCase();
    
    // Determine user ID (use 'new' for registration, actual ID for updates)
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

// =====================================================
// CLOUDINARY STORAGE FOR RISK DATA FILES
// =====================================================
const riskDataStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const userId = req.user?.id || 'system';
    
    return {
      folder: 'kovapage/risk-data',
      public_id: `risk-${userId}-${Date.now()}`,
      resource_type: 'raw' // For non-image files (Excel, CSV, JSON)
    };
  }
});

// =====================================================
// FILE FILTER - Validate file types
// =====================================================
const fileFilter = (req, file, cb) => {
  const extname = path.extname(file.originalname).toLowerCase();
  
  // Check if it's a profile photo (image)
  if (file.fieldname === 'profilePhoto') {
    const allowedImageTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    
    if (allowedImageTypes.includes(extname) || allowedMimeTypes.includes(file.mimetype)) {
      return cb(null, true);
    } else {
      return cb(new Error('Only image files are allowed for profile photos (jpeg, jpg, png, gif, webp)'));
    }
  }
  
  // Check if it's a risk data file
  if (file.fieldname === 'riskFile') {
    const allowedRiskExts = ['.xlsx', '.xls', '.csv', '.json'];
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'application/json' // .json
    ];
    
    if (allowedRiskExts.includes(extname) || allowedMimeTypes.includes(file.mimetype)) {
      return cb(null, true);
    } else {
      return cb(new Error('Only Excel, CSV, and JSON files are allowed for risk data'));
    }
  }
  
  // If fieldname doesn't match either
  return cb(new Error('Invalid file field. Use "profilePhoto" or "riskFile"'));
};

// =====================================================
// MULTER UPLOAD INSTANCES
// =====================================================

// For profile photos (5MB limit)
const uploadProfilePhoto = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: fileFilter
});

// For risk data files (10MB limit)
const uploadRiskData = multer({
  storage: riskDataStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilter
});

// Generic upload that can handle both (use with caution)
const upload = multer({
  storage: profilePhotoStorage, // Default to profile photo storage
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

// =====================================================
// HELPER FUNCTION TO DELETE FILES FROM CLOUDINARY
// =====================================================
const deleteFromCloudinary = async (publicId) => {
  try {
    if (!publicId) return null;
    
    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`✅ Deleted from Cloudinary: ${publicId}`, result);
    return result;
  } catch (error) {
    console.error(`❌ Error deleting from Cloudinary: ${publicId}`, error);
    throw error;
  }
};

// =====================================================
// EXPORT
// =====================================================
module.exports = {
  uploadProfilePhoto,
  uploadRiskData,
  upload,
  deleteFromCloudinary
};