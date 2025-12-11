import mongoose from 'mongoose';

const RecipientSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    lowercase: true
  },
  name: {
    type: String,
    default: ''
  },
  percentage: {
    type: Number,
    required: true,
    min: 0.01,
    max: 100
  },
  share: {
    type: Number,
    required: true,
    min: 1,
    max: 10000
  },
  email: {
    type: String,
    lowercase: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

const DistributionSchema = new mongoose.Schema({
  txHash: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  triggeredBy: {
    type: String,
    enum: ['manual', 'auto', 'api'],
    default: 'manual'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const PaymentLinkSchema = new mongoose.Schema({
  linkId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  amount: Number,
  currency: {
    type: String,
    default: 'USDC'
  },
  redirectUrl: String,
  expiresAt: Date,
  maxUses: Number,
  usageCount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const SplitSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: true,
    trim: true
  },
  contractAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  owner: {
    type: String,
    required: true,
    lowercase: true
  },
  
  // Configuration
  recipients: [RecipientSchema],
  token: {
    type: String,
    required: true,
    lowercase: true
  },
  tokenSymbol: String,
  tokenDecimals: {
    type: Number,
    default: 6
  },
  
  // Settings
  active: {
    type: Boolean,
    default: true
  },
  autoDistribute: {
    type: Boolean,
    default: false
  },
  distributionThreshold: {
    type: Number,
    default: 0
  },
  
  // Notification Settings
  notificationSettings: {
    email: {
      type: Boolean,
      default: false
    },
    webhook: String,
    onPayment: {
      type: Boolean,
      default: true
    },
    onDistribution: {
      type: Boolean,
      default: true
    }
  },
  
  // Stats
  totalPayments: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  totalDistributed: {
    type: Number,
    default: 0
  },
  
  // Payment Links
  paymentLinks: [PaymentLinkSchema],
  
  // History
  distributions: [DistributionSchema],
  lastPayment: Date,
  lastDistribution: Date,
  
  // Metadata
  metadata: mongoose.Schema.Types.Mixed,
  tags: [String],
  
  // Timestamps
  createdTx: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  deactivatedAt: Date
});

// Indexes
SplitSchema.index({ owner: 1 });
SplitSchema.index({ contractAddress: 1 });
SplitSchema.index({ 'recipients.address': 1 });
SplitSchema.index({ active: 1, autoDistribute: 1 });
SplitSchema.index({ createdAt: -1 });
SplitSchema.index({ totalAmount: -1 });

// Update timestamp on save
SplitSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for total shares
SplitSchema.virtual('totalShares').get(function() {
  return this.recipients.reduce((sum, recipient) => sum + recipient.share, 0);
});

// Methods
SplitSchema.methods.getRecipientShare = function(address) {
  const recipient = this.recipients.find(r => 
    r.address.toLowerCase() === address.toLowerCase()
  );
  return recipient ? recipient.percentage : 0;
};

SplitSchema.methods.addPaymentLink = async function(linkData) {
  const linkId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const paymentLink = {
    linkId,
    ...linkData,
    createdAt: new Date(),
    isActive: true,
    usageCount: 0,
    totalAmount: 0
  };
  
  this.paymentLinks.push(paymentLink);
  await this.save();
  
  return paymentLink;
};

SplitSchema.methods.recordPayment = async function(amount, txHash) {
  this.totalPayments += 1;
  this.totalAmount += amount;
  this.lastPayment = new Date();
  
  if (this.autoDistribute && amount >= this.distributionThreshold) {
    this.distributions.push({
      txHash,
      amount,
      triggeredBy: 'auto',
      timestamp: new Date()
    });
    this.lastDistribution = new Date();
  }
  
  await this.save();
};

// Static methods
SplitSchema.statics.findByOwner = function(ownerAddress) {
  return this.find({ 
    owner: ownerAddress.toLowerCase(),
    active: true 
  }).sort({ createdAt: -1 });
};

SplitSchema.statics.findByRecipient = function(recipientAddress) {
  return this.find({ 
    'recipients.address': recipientAddress.toLowerCase(),
    active: true 
  });
};

SplitSchema.statics.getPlatformStats = async function() {
  const stats = await this.aggregate([
    {
      $match: { active: true }
    },
    {
      $group: {
        _id: null,
        totalSplits: { $sum: 1 },
        totalRecipients: { $sum: { $size: '$recipients' } },
        totalVolume: { $sum: '$totalAmount' },
        avgRecipients: { $avg: { $size: '$recipients' } }
      }
    }
  ]);
  
  return stats[0] || {
    totalSplits: 0,
    totalRecipients: 0,
    totalVolume: 0,
    avgRecipients: 0
  };
};

const Split = mongoose.model('Split', SplitSchema);

export default Split;
