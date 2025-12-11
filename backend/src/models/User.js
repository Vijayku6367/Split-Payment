import mongoose from 'mongoose';

const ApiKeySchema = new mongoose.Schema({
  keyHash: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  permissions: [{
    type: String,
    enum: ['read', 'write', 'admin', 'contract:create', 'payment:process', 'payment:batch', '*'],
    default: ['read']
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

const UserSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  email: {
    type: String,
    lowercase: true,
    sparse: true
  },
  username: {
    type: String,
    unique: true,
    sparse: true
  },
  nonce: {
    type: String,
    required: true
  },
  apiKeys: [ApiKeySchema],
  tier: {
    type: String,
    enum: ['free', 'pro', 'enterprise'],
    default: 'free'
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    emailNotifications: {
      type: Boolean,
      default: true
    },
    defaultToken: {
      type: String,
      default: 'USDC'
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    }
  },
  stats: {
    totalSplits: {
      type: Number,
      default: 0
    },
    totalPayments: {
      type: Number,
      default: 0
    },
    totalVolume: {
      type: Number,
      default: 0
    }
  },
  lastLogin: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
UserSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static methods
UserSchema.statics.findByWalletAddress = function(address) {
  return this.findOne({ walletAddress: address.toLowerCase() });
};

UserSchema.statics.findByApiKey = function(apiKeyHash) {
  return this.findOne({ 'apiKeys.keyHash': apiKeyHash, 'apiKeys.isActive': true });
};

// Instance methods
UserSchema.methods.generateNonce = function() {
  this.nonce = require('crypto').randomBytes(16).toString('hex');
  return this.nonce;
};

UserSchema.methods.deactivateApiKey = function(keyHash) {
  const apiKey = this.apiKeys.find(key => key.keyHash === keyHash);
  if (apiKey) {
    apiKey.isActive = false;
  }
  return this.save();
};

const User = mongoose.model('User', UserSchema);

export default User;
