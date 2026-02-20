const cloudinary = require('../config/cloudinary');

const deleteImage = async (publicId) => {
  try {
    if (!publicId) return;
    
    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`✅ Deleted image ${publicId} from Cloudinary:`, result);
    return result;
  } catch (error) {
    console.error(`❌ Error deleting image ${publicId}:`, error);
  }
};

const cleanupUserImages = async (user) => {
  if (user.profilePhotoPublicId) {
    await deleteImage(user.profilePhotoPublicId);
  }
};

module.exports = {
  deleteImage,
  cleanupUserImages
};