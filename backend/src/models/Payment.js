import mongoose from 'mongoose';

const DistributionDetailSchema = new mongoose.Schema({
  recipient: {
    type: String,
    required: true,
    lowercase: true
  },
  amount: {
    type: Number,
    required: true
  },
  amountWei: {
    type: String,
    required: true
  },
  percentage: Number
});

const PaymentSchema = new mongoose.Schema({
  // Payment Info
  splitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Split',
    required: true
  },
  contractAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  
  // Payer Info
  payerAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  payerName: String,
  payerEmail: String,
  
  // Payment Details
  amount: {
    type: Number,
    required: true
  },
  amountWei: {
    type: String,
    required: true
  },
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
  
  // Blockchain Data
  txHash: {
    type: String,
    required: true,
    unique: true
  },
  blockNumber: Number,
  blockHash: String,
  gasUsed: String,
  gasPrice: String,
  
  // Distribution Details
  distributions: [DistributionDetailSchema],
  
  // Metadata
  memo: String,
  paymentLinkId: String,
  referrer: String,
  metadata: mongoose.Schema.Types.Mixed,
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  error: String,
  
  // Batch Info
  batchId: String,
  isBatch: {
    type: Boolean,
    default: false
  },
  
  // Timestamps
  timestamp: {
    type: Date,
    default: Date.now
  },
  confirmedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
PaymentSchema.index({ payerAddress: 1 });
PaymentSchema.index({ contractAddress: 1 });
PaymentSchema.index({ splitId: 1 });
PaymentSchema.index({ txHash: 1 });
PaymentSchema.index({ timestamp: -1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ token: 1 });
PaymentSchema.index({ paymentLinkId: 1 });
PaymentSchema.index({ 'distributions.recipient': 1 });

// Update timestamp on save
PaymentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  if (this.status === 'completed' && !this.confirmedAt) {
    this.confirmedAt = new Date();
  }
  
  next();
});

// Virtuals
PaymentSchema.virtual('formattedAmount').get(function() {
  return this.amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: this.tokenDecimals || 6
  });
});

PaymentSchema.virtual('explorerUrl').get(function() {
  const explorer = process.env.BLOCK_EXPLORER_URL || 'https://tempotestnet.io';
  return `${explorer}/tx/${this.txHash}`;
});

// Methods
PaymentSchema.methods.getRecipientAmount = function(recipientAddress) {
  const distribution = this.distributions.find(d => 
    d.recipient.toLowerCase() === recipientAddress.toLowerCase()
  );
  return distribution ? distribution.amount : 0;
};

PaymentSchema.methods.markAsCompleted = function(txData) {
  this.status = 'completed';
  this.blockNumber = txData.blockNumber;
  this.blockHash = txData.blockHash;
  this.gasUsed = txData.gasUsed?.toString();
  this.gasPrice = txData.gasPrice?.toString();
  this.confirmedAt = new Date();
};

// Static methods
PaymentSchema.statics.getDailyVolume = async function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        status: 'completed',
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
        },
        date: { $first: "$timestamp" },
        count: { $sum: 1 },
        volume: { $sum: "$amount" },
        uniquePayers: { $addToSet: "$payerAddress" },
        uniqueSplits: { $addToSet: "$contractAddress" }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

PaymentSchema.statics.getTokenStats = async function() {
  return this.aggregate([
    {
      $match: { status: 'completed' }
    },
    {
      $group: {
        _id: "$token",
        tokenSymbol: { $first: "$tokenSymbol" },
        count: { $sum: 1 },
        volume: { $sum: "$amount" },
        avgAmount: { $avg: "$amount" },
        lastPayment: { $max: "$timestamp" }
      }
    },
    { $sort: { volume: -1 } }
  ]);
};

PaymentSchema.statics.getPayerStats = function(payerAddress) {
  return this.aggregate([
    {
      $match: {
        payerAddress: payerAddress.toLowerCase(),
        status: 'completed'
      }
    },
    {
      $group: {
        _id: null,
        totalPayments: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
        firstPayment: { $min: "$timestamp" },
        lastPayment: { $max: "$timestamp" },
        uniqueSplits: { $addToSet: "$contractAddress" },
        tokensUsed: { $addToSet: "$token" }
      }
    }
  ]);
};

PaymentSchema.statics.findByPaymentLink = function(linkId) {
  return this.find({ 
    paymentLinkId: linkId,
    status: 'completed'
  }).sort({ timestamp: -1 });
};

const Payment = mongoose.model('Payment', PaymentSchema);

export default Payment;
