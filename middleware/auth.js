const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');

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