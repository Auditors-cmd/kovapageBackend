const jwt = require('jsonwebtoken');
const User = require('../models/User');

const resolveJwtSecretForVerify = () => {
  const secret = process.env.JWT_SECRET;
  const weakSecret = !secret || secret === 'dev-secret-key' || String(secret).includes('change_this_in_production');

  if (process.env.NODE_ENV === 'production' && weakSecret) {
    return null;
  }

  return secret || 'dev-secret-key';
};

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const jwtSecret = resolveJwtSecretForVerify();

      if (!jwtSecret) {
        return res.status(500).json({
          success: false,
          message: 'Authentication service is not configured securely'
        });
      }

      // Verify token
      const decoded = jwt.verify(token, jwtSecret);

      // Get user from token
      req.user = await User.findByPk(decoded.id);

      if (!req.user || !req.user.isActive) {
        return res.status(401).json({ 
          success: false,
          message: 'Not authorized' 
        });
      }

      next();
    } catch (error) {
      console.error('Token verification error:', error);
      res.status(401).json({ 
        success: false,
        message: 'Not authorized' 
      });
    }
  } else {
    res.status(401).json({ 
      success: false,
      message: 'Not authorized, no token' 
    });
  }
};

module.exports = { protect };
