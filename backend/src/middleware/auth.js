import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';

/**
 * Middleware to verify wallet signature and authenticate user
 */
export const authenticateWallet = async (req, res, next) => {
  try {
    const { signature, message, address } = req.body;
    
    // Check if required fields are present
    if (!signature || !message || !address) {
      return res.status(400).json({
        success: false,
        error: 'Signature, message, and address are required'
      });
    }

    // Validate Ethereum address format
    if (!ethers.isAddress(address)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Ethereum address'
      });
    }

    // Recover address from signature
    let recoveredAddress;
    try {
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature format'
      });
    }

    // Verify that recovered address matches provided address
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({
        success: false,
        error: 'Signature does not match address'
      });
    }

    // Check if message is recent (prevent replay attacks)
    const messageData = JSON.parse(message);
    const timestamp = messageData.timestamp;
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (!timestamp || Math.abs(now - timestamp) > maxAge) {
      return res.status(401).json({
        success: false,
        error: 'Signature expired'
      });
    }

    // Check if message matches expected format
    if (messageData.domain !== process.env.AUTH_DOMAIN || 
        messageData.purpose !== 'authentication') {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication message'
      });
    }

    // Find or create user
    let user = await User.findOne({ walletAddress: address.toLowerCase() });

    if (!user) {
      // Create new user
      user = new User({
        walletAddress: address.toLowerCase(),
        nonce: crypto.randomBytes(16).toString('hex'),
        lastLogin: new Date(),
        isActive: true
      });
    } else {
      // Update nonce for next login
      user.nonce = crypto.randomBytes(16).toString('hex');
      user.lastLogin = new Date();
    }

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._id,
        walletAddress: user.walletAddress,
        isAdmin: user.isAdmin || false
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Set user in request
    req.user = {
      id: user._id,
      walletAddress: user.walletAddress,
      isAdmin: user.isAdmin || false
    };

    // Send token in response
    res.locals.token = token;
    res.locals.user = req.user;

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/**
 * Middleware to verify JWT token
 */
export const verifyToken = (req, res, next) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists
    req.user = decoded;
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Token verification failed'
    });
  }
};

/**
 * Middleware to require admin privileges
 */
export const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Admin privileges required'
    });
  }
  next();
};

/**
 * Middleware to check ownership of split contract
 */
export const checkSplitOwnership = async (req, res, next) => {
  try {
    const splitAddress = req.params.address || req.body.splitAddress;
    const userAddress = req.user.walletAddress;

    if (!splitAddress) {
      return res.status(400).json({
        success: false,
        error: 'Split address is required'
      });
    }

    // In production, you would check against the blockchain
    // For now, we'll simulate with a database check
    const Split = require('../models/Split.js');
    const split = await Split.findOne({
      contractAddress: splitAddress.toLowerCase(),
      owner: userAddress.toLowerCase()
    });

    if (!split) {
      return res.status(403).json({
        success: false,
        error: 'You do not own this split contract'
      });
    }

    req.split = split;
    next();
  } catch (error) {
    console.error('Ownership check error:', error);
    res.status(500).json({
      success: false,
      error: 'Ownership verification failed'
    });
  }
};

/**
 * Generate authentication message for wallet signing
 */
export const generateAuthMessage = (address) => {
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  
  const message = JSON.stringify({
    domain: process.env.AUTH_DOMAIN || 'split-payments.example.com',
    address: address.toLowerCase(),
    statement: 'Sign this message to authenticate with Split Payments Platform',
    version: '1',
    chainId: process.env.CHAIN_ID || '1',
    nonce: nonce,
    issuedAt: new Date(timestamp).toISOString(),
    expirationTime: new Date(timestamp + 5 * 60 * 1000).toISOString(), // 5 minutes
    notBefore: new Date(timestamp).toISOString(),
    requestId: crypto.randomBytes(8).toString('hex'),
    resources: ['https://split-payments.example.com'],
    purpose: 'authentication'
  });

  return {
    message,
    nonce,
    timestamp
  };
};

/**
 * Generate API key for user
 */
export const generateApiKey = async (userId, name, permissions = ['read']) => {
  const apiKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  // Store hashed key in database
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  user.apiKeys.push({
    keyHash: hashedKey,
    name,
    permissions,
    createdAt: new Date(),
    lastUsed: null,
    isActive: true
  });

  await user.save();

  return {
    apiKey, // Only returned once
    keyId: hashedKey.substring(0, 16),
    name,
    permissions,
    createdAt: new Date()
  };
};

/**
 * Middleware to verify API key
 */
export const verifyApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key is required'
      });
    }

    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    // Find user by API key
    const user = await User.findOne({
      'apiKeys.keyHash': hashedKey,
      'apiKeys.isActive': true
    });

    if (!user) {
      return res.status(403).json({
        success: false,
        error: 'Invalid API key'
      });
    }

    // Check if API key has required permissions
    const apiKeyData = user.apiKeys.find(key => key.keyHash === hashedKey);
    const routePermissions = getRoutePermissions(req.path, req.method);
    
    const hasPermission = routePermissions.every(permission => 
      apiKeyData.permissions.includes(permission) || 
      apiKeyData.permissions.includes('*')
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    // Update last used time
    apiKeyData.lastUsed = new Date();
    await user.save();

    // Set user in request
    req.user = {
      id: user._id,
      walletAddress: user.walletAddress,
      isAdmin: user.isAdmin || false,
      apiKeyPermissions: apiKeyData.permissions
    };

    next();
  } catch (error) {
    console.error('API key verification error:', error);
    res.status(500).json({
      success: false,
      error: 'API key verification failed'
    });
  }
};

/**
 * Get required permissions for a route
 */
const getRoutePermissions = (path, method) => {
  const permissions = {
    'GET': ['read'],
    'POST': ['write'],
    'PUT': ['write'],
    'DELETE': ['write']
  };

  const routePermissions = {
    '/api/split/create': ['write', 'contract:create'],
    '/api/split/:address/distribute': ['write', 'payment:process'],
    '/api/payment/process': ['write', 'payment:process'],
    '/api/payment/batch': ['write', 'payment:batch'],
    '/api/admin': ['admin']
  };

  const defaultPerms = permissions[method] || ['read'];
  const routePerms = routePermissions[path] || [];
  
  return [...defaultPerms, ...routePerms];
};

/**
 * Rate limiting based on user tier
 */
export const tieredRateLimit = (req, res, next) => {
  const userTier = req.user?.tier || 'free';
  const limits = {
    free: { windowMs: 15 * 60 * 1000, max: 100 },
    pro: { windowMs: 15 * 60 * 1000, max: 1000 },
    enterprise: { windowMs: 15 * 60 * 1000, max: 10000 }
  };

  const limit = limits[userTier] || limits.free;
  
  // Implement rate limiting logic here
  // You can use express-rate-limit package
  
  next();
};

/**
 * CORS middleware
 */
export const corsMiddleware = (req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:5173'
  ];

  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key, X-Signature, X-Wallet-Address');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
};

/**
 * Logging middleware
 */
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id || 'anonymous',
      walletAddress: req.user?.walletAddress || 'none'
    };

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(JSON.stringify(logData, null, 2));
    }

    // In production, log to file or monitoring service
  });
  
  next();
};

/**
 * Error handling middleware
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || 'INTERNAL_ERROR';

  // Don't expose internal errors in production
  const errorResponse = {
    success: false,
    error: message,
    code: code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };

  res.status(statusCode).json(errorResponse);
};

/**
 * Security headers middleware
 */
export const securityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.header('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.header('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.header('X-XSS-Protection', '1; mode=block');
  
  // Strict Transport Security
  if (process.env.NODE_ENV === 'production') {
    res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  // Content Security Policy
  res.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  );
  
  next();
};

export default {
  authenticateWallet,
  verifyToken,
  requireAdmin,
  checkSplitOwnership,
  generateAuthMessage,
  generateApiKey,
  verifyApiKey,
  tieredRateLimit,
  corsMiddleware,
  requestLogger,
  errorHandler,
  securityHeaders
};
export const rateLimiter = (req, res, next) => {
  next();
};

