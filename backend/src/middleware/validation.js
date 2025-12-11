import Joi from 'joi';

/**
 * Middleware to validate request body using Joi schemas
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {string} source - Request property to validate (body, query, params)
 */
export const validateRequest = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req[source], {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: true
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message.replace(/['"]/g, '')
        }));

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors
        });
      }

      // Replace request data with validated values
      req[source] = value;
      next();
    } catch (err) {
      console.error('Validation middleware error:', err);
      res.status(500).json({
        success: false,
        error: 'Internal validation error'
      });
    }
  };
};

/**
 * Common validation schemas for reuse
 */
export const validationSchemas = {
  // Ethereum address validation
  address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required().messages({
    'string.pattern.base': 'Invalid Ethereum address format'
  }),

  // Transaction hash validation
  txHash: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required().messages({
    'string.pattern.base': 'Invalid transaction hash format'
  }),

  // Percentage validation (0-100)
  percentage: Joi.number().min(0.01).max(100).precision(2).required().messages({
    'number.min': 'Percentage must be at least 0.01%',
    'number.max': 'Percentage cannot exceed 100%'
  }),

  // Basis points validation (0-10000)
  basisPoints: Joi.number().integer().min(1).max(10000).required().messages({
    'number.min': 'Shares must be at least 1 basis point',
    'number.max': 'Shares cannot exceed 10000 basis points'
  }),

  // Positive amount validation
  amount: Joi.number().positive().required().messages({
    'number.positive': 'Amount must be positive'
  }),

  // Wallet signature validation
  signature: Joi.string().pattern(/^0x[a-fA-F0-9]{130}$/).required().messages({
    'string.pattern.base': 'Invalid signature format'
  }),

  // Email validation
  email: Joi.string().email().max(100).messages({
    'string.email': 'Invalid email format'
  }),

  // URL validation
  url: Joi.string().uri().max(500).messages({
    'string.uri': 'Invalid URL format'
  }),

  // Pagination parameters
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('desc'),
    sortBy: Joi.string().max(50).default('createdAt')
  },

  // Date range validation
  dateRange: Joi.object({
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')),
    period: Joi.string().valid('7d', '30d', '90d', '1y', 'all').default('30d')
  }),

  // Split creation schema
  createSplit: Joi.object({
    name: Joi.string().max(100).optional(),
    recipients: Joi.array().items(
      Joi.object({
        address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
        percentage: Joi.number().min(0.01).max(100).required(),
        name: Joi.string().max(50).optional(),
        email: Joi.string().email().optional()
      })
    ).min(1).max(50).required(),
    token: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    autoDistribute: Joi.boolean().default(false),
    distributionThreshold: Joi.number().positive().default(0),
    notificationSettings: Joi.object({
      email: Joi.boolean().default(false),
      webhook: Joi.string().uri().optional(),
      onPayment: Joi.boolean().default(true),
      onDistribution: Joi.boolean().default(true)
    }).optional(),
    metadata: Joi.object().optional()
  }),

  // Payment processing schema
  processPayment: Joi.object({
    splitAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    amount: Joi.number().positive().required(),
    token: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    payer: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    signature: Joi.string().pattern(/^0x[a-fA-F0-9]{130}$/).required(),
    memo: Joi.string().max(500).optional(),
    paymentLinkId: Joi.string().max(50).optional(),
    referrer: Joi.string().max(100).optional()
  }),

  // Update split schema
  updateSplit: Joi.object({
    recipients: Joi.array().items(
      Joi.object({
        address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
        percentage: Joi.number().min(0.01).max(100).required()
      })
    ).min(1).max(50),
    active: Joi.boolean(),
    autoDistribute: Joi.boolean(),
    distributionThreshold: Joi.number().positive(),
    notificationSettings: Joi.object({
      email: Joi.boolean(),
      webhook: Joi.string().uri(),
      onPayment: Joi.boolean(),
      onDistribution: Joi.boolean()
    }),
    metadata: Joi.object()
  }),

  // Generate payment link schema
  generatePaymentLink: Joi.object({
    title: Joi.string().max(100).required(),
    description: Joi.string().max(500).optional(),
    amount: Joi.number().positive().optional(),
    currency: Joi.string().max(10).default('USDC'),
    redirectUrl: Joi.string().uri().optional(),
    expiresAt: Joi.date().iso().min('now').optional(),
    maxUses: Joi.number().integer().min(1).optional(),
    metadata: Joi.object().optional()
  }),

  // Webhook validation schema
  webhookPayload: Joi.object({
    event: Joi.string().required(),
    data: Joi.object().required(),
    signature: Joi.string().required(),
    timestamp: Joi.date().iso().required()
  })
};

/**
 * Custom validation for checking if percentages sum to 100%
 */
export const validatePercentageSum = (recipients) => {
  const total = recipients.reduce((sum, recipient) => sum + recipient.percentage, 0);
  return Math.abs(total - 100) < 0.01; // Allow small floating point errors
};

/**
 * Custom validation for unique recipient addresses
 */
export const validateUniqueRecipients = (recipients) => {
  const addresses = recipients.map(r => r.address.toLowerCase());
  const uniqueAddresses = new Set(addresses);
  return addresses.length === uniqueAddresses.size;
};

/**
 * Middleware to validate API key
 */
export const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key is required'
    });
  }

  // Validate API key (in production, check against database)
  const validKeys = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];
  
  if (!validKeys.includes(apiKey)) {
    return res.status(403).json({
      success: false,
      error: 'Invalid API key'
    });
  }

  req.apiKey = apiKey;
  next();
};

/**
 * Middleware to validate webhook signature
 */
export const validateWebhookSignature = (secret) => {
  return (req, res, next) => {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (!signature || !timestamp) {
      return res.status(400).json({
        success: false,
        error: 'Missing webhook signature or timestamp'
      });
    }

    // Check if timestamp is within acceptable range (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    
    if (Math.abs(now - requestTime) > 300) {
      return res.status(400).json({
        success: false,
        error: 'Webhook timestamp is too old or in the future'
      });
    }

    // Verify signature (implement based on your webhook provider)
    // This is a simplified example
    const payload = `${timestamp}.${JSON.stringify(req.body)}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }

    next();
  };
};

/**
 * Sanitize input data to prevent XSS attacks
 */
export const sanitizeInput = (data) => {
  if (typeof data === 'string') {
    // Remove HTML tags
    return data.replace(/<[^>]*>/g, '');
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeInput(item));
  }
  if (typeof data === 'object' && data !== null) {
    const sanitized = {};
    for (const key in data) {
      sanitized[key] = sanitizeInput(data[key]);
    }
    return sanitized;
  }
  return data;
};

/**
 * Middleware to sanitize request body
 */
export const sanitizeBody = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  if (req.query) {
    req.query = sanitizeInput(req.query);
  }
  if (req.params) {
    req.params = sanitizeInput(req.params);
  }
  next();
};

/**
 * Validate Ethereum transaction
 */
export const validateTransaction = async (txHash, provider) => {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return { valid: false, error: 'Transaction not found' };
    }

    if (receipt.status !== 1) {
      return { valid: false, error: 'Transaction failed' };
    }

    return { valid: true, receipt };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

/**
 * Validate wallet signature
 */
export const validateWalletSignature = async (message, signature, expectedAddress) => {
  try {
    // Recover address from signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    // Compare with expected address (case-insensitive)
    if (recoveredAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
      return { valid: false, error: 'Signature does not match address' };
    }

    return { valid: true, address: recoveredAddress };
  } catch (error) {
    return { valid: false, error: 'Invalid signature' };
  }
};

/**
 * Rate limiting middleware
 */
export const rateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // limit each IP to 100 requests per windowMs
    message = 'Too many requests, please try again later.',
    skipSuccessfulRequests = false
  } = options;

  const requests = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!requests.has(ip)) {
      requests.set(ip, []);
    }
    
    const windowStart = now - windowMs;
    const userRequests = requests.get(ip).filter(time => time > windowStart);
    
    if (userRequests.length >= max) {
      return res.status(429).json({
        success: false,
        error: message,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
    
    userRequests.push(now);
    requests.set(ip, userRequests);
    
    // Cleanup old entries
    setTimeout(() => {
      const currentTime = Date.now();
      for (const [key, times] of requests.entries()) {
        const validTimes = times.filter(time => time > currentTime - windowMs);
        if (validTimes.length === 0) {
          requests.delete(key);
        } else {
          requests.set(key, validTimes);
        }
      }
    }, windowMs);
    
    if (!skipSuccessfulRequests || res.statusCode >= 400) {
      // Track all requests or only failed ones
    }
    
    next();
  };
};

export default {
  validateRequest,
  validationSchemas,
  validateApiKey,
  validateWebhookSignature,
  sanitizeBody,
  rateLimiter,
  validatePercentageSum,
  validateUniqueRecipients,
  validateTransaction,
  validateWalletSignature
};
