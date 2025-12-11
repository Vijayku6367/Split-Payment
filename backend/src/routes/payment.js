import express from 'express';
import { ethers } from 'ethers';
import Joi from 'joi';
import Payment from '../models/Payment.js';
import Split from '../models/Split.js';
import { validateRequest } from '../middleware/validation.js';

const router = express.Router();

// Joi validation schemas
const paymentSchema = Joi.object({
  splitAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  amount: Joi.number().positive().required(),
  token: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  payer: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  memo: Joi.string().max(200).optional(),
  paymentLinkId: Joi.string().optional()
});

const batchPaymentSchema = Joi.object({
  payments: Joi.array().items(
    Joi.object({
      splitAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
      amount: Joi.number().positive().required()
    })
  ).min(1).max(50).required(),
  token: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required()
});

// Connect to Tempo network
const provider = new ethers.JsonRpcProvider(process.env.TEMPO_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

/**
 * @route   POST /api/payment/process
 * @desc    Process a payment to a split contract
 * @access  Public (requires valid signature)
 */
router.post('/process', validateRequest(paymentSchema), async (req, res) => {
  try {
    const { splitAddress, amount, token, payer, memo, paymentLinkId } = req.body;
    
    // Verify split exists and is active
    const split = await Split.findOne({ 
      contractAddress: splitAddress,
      active: true 
    });

    if (!split) {
      return res.status(404).json({ 
        success: false, 
        error: 'Split contract not found or inactive' 
      });
    }

    // Check token matches
    if (split.token.toLowerCase() !== token.toLowerCase()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token mismatch' 
      });
    }

    // ABI for Splitter contract
    const SPLITTER_ABI = [
      "function distribute(uint256 amount) external",
      "function getConfig() view returns (tuple(address[] recipients, uint256[] shares, address token, address owner, bool active))",
      "event PaymentReceived(address indexed payer, uint256 amount, address token)",
      "event Distributed(address indexed recipient, uint256 amount)"
    ];

    const splitterContract = new ethers.Contract(
      splitAddress,
      SPLITTER_ABI,
      wallet
    );

    // Get token decimals
    const ERC20_ABI = [
      "function decimals() view returns (uint8)"
    ];
    
    const tokenContract = new ethers.Contract(token, ERC20_ABI, provider);
    const decimals = await tokenContract.decimals();
    const amountWei = ethers.parseUnits(amount.toString(), decimals);

    // Execute distribution
    const tx = await splitterContract.distribute(amountWei);
    const receipt = await tx.wait();

    // Extract events from receipt
    const paymentEvent = receipt.logs.find(log => 
      log.fragment && log.fragment.name === 'PaymentReceived'
    );
    
    const distributionEvents = receipt.logs.filter(log => 
      log.fragment && log.fragment.name === 'Distributed'
    );

    // Save payment record
    const payment = new Payment({
      splitId: split._id,
      contractAddress: splitAddress,
      payerAddress: payer,
      amount: amount,
      amountWei: amountWei.toString(),
      token: token,
      tokenDecimals: decimals,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      memo: memo,
      paymentLinkId: paymentLinkId,
      status: 'completed',
      timestamp: new Date(),
      distributions: distributionEvents.map(event => ({
        recipient: event.args[0],
        amount: ethers.formatUnits(event.args[1], decimals),
        amountWei: event.args[1].toString()
      }))
    });

    await payment.save();

    // Update split stats
    await Split.findByIdAndUpdate(split._id, {
      $inc: { 
        totalPayments: 1,
        totalAmount: amount 
      },
      $set: { lastPayment: new Date() }
    });

    // If payment link was used, update its stats
    if (paymentLinkId) {
      // Update payment link usage (implement based on your PaymentLink model)
    }

    // Send notifications (implement email/webhook notifications)

    res.json({
      success: true,
      message: 'Payment processed successfully',
      data: {
        paymentId: payment._id,
        txHash: tx.hash,
        explorerUrl: `${process.env.BLOCK_EXPLORER_URL}/tx/${tx.hash}`,
        amount: amount,
        distributions: payment.distributions,
        timestamp: payment.timestamp
      }
    });

  } catch (error) {
    console.error('Error processing payment:', error);
    
    // Save failed payment attempt
    if (req.body.splitAddress) {
      try {
        const failedPayment = new Payment({
          splitId: null,
          contractAddress: req.body.splitAddress,
          payerAddress: req.body.payer,
          amount: req.body.amount,
          token: req.body.token,
          status: 'failed',
          error: error.message,
          timestamp: new Date()
        });
        await failedPayment.save();
      } catch (dbError) {
        console.error('Failed to save error log:', dbError);
      }
    }

    res.status(500).json({ 
      success: false, 
      error: error.message || 'Payment processing failed' 
    });
  }
});

/**
 * @route   POST /api/payment/batch
 * @desc    Process batch payments to multiple splits
 * @access  Private (requires admin/signature)
 */
router.post('/batch', validateRequest(batchPaymentSchema), async (req, res) => {
  try {
    const { payments, token } = req.body;
    const adminSignature = req.headers['x-admin-signature'];

    // Verify admin signature (implement proper verification)
    // For demo: check against stored admin key
    
    const results = [];
    const errors = [];

    // Get token decimals
    const ERC20_ABI = ["function decimals() view returns (uint8)"];
    const tokenContract = new ethers.Contract(token, ERC20_ABI, provider);
    const decimals = await tokenContract.decimals();

    // Process each payment
    for (const payment of payments) {
      try {
        const { splitAddress, amount } = payment;
        
        // Verify split exists
        const split = await Split.findOne({ 
          contractAddress: splitAddress,
          active: true 
        });

        if (!split) {
          errors.push({
            splitAddress,
            error: 'Split not found or inactive',
            amount
          });
          continue;
        }

        // ABI for Splitter
        const SPLITTER_ABI = ["function distribute(uint256 amount) external"];
        const splitterContract = new ethers.Contract(splitAddress, SPLITTER_ABI, wallet);
        
        const amountWei = ethers.parseUnits(amount.toString(), decimals);
        const tx = await splitterContract.distribute(amountWei);
        const receipt = await tx.wait();

        // Save payment record
        const paymentRecord = new Payment({
          splitId: split._id,
          contractAddress: splitAddress,
          payerAddress: wallet.address,
          amount: amount,
          amountWei: amountWei.toString(),
          token: token,
          tokenDecimals: decimals,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          status: 'completed',
          timestamp: new Date(),
          batchId: `batch_${Date.now()}`,
          isBatch: true
        });

        await paymentRecord.save();

        // Update split stats
        await Split.findByIdAndUpdate(split._id, {
          $inc: { 
            totalPayments: 1,
            totalAmount: amount 
          }
        });

        results.push({
          splitAddress,
          success: true,
          txHash: tx.hash,
          amount: amount
        });

      } catch (error) {
        errors.push({
          splitAddress: payment.splitAddress,
          error: error.message,
          amount: payment.amount
        });
      }
    }

    res.json({
      success: true,
      message: 'Batch processing completed',
      data: {
        processed: results.length,
        failed: errors.length,
        results: results,
        errors: errors
      }
    });

  } catch (error) {
    console.error('Error in batch processing:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/payment/history/:address
 * @desc    Get payment history for an address (payer or split)
 * @access  Public
 */
router.get('/history/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { 
      page = 1, 
      limit = 20,
      type = 'all', // 'sent', 'received', 'split'
      token,
      startDate,
      endDate
    } = req.query;

    const query = {};
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query based on type
    if (type === 'sent') {
      query.payerAddress = address.toLowerCase();
    } else if (type === 'received') {
      // This would require checking recipient addresses in distributions
      // For now, query by split ownership
      const splits = await Split.find({ owner: address.toLowerCase() });
      const splitIds = splits.map(s => s._id);
      query.splitId = { $in: splitIds };
    } else if (type === 'split') {
      const split = await Split.findOne({ contractAddress: address.toLowerCase() });
      if (split) {
        query.splitId = split._id;
      } else {
        query.contractAddress = address.toLowerCase();
      }
    } else {
      // 'all' - check all possibilities
      query.$or = [
        { payerAddress: address.toLowerCase() },
        { contractAddress: address.toLowerCase() }
      ];
    }

    // Additional filters
    if (token) {
      query.token = token.toLowerCase();
    }
    if (startDate) {
      query.timestamp = { $gte: new Date(startDate) };
    }
    if (endDate) {
      query.timestamp = query.timestamp || {};
      query.timestamp.$lte = new Date(endDate);
    }
    if (startDate && endDate) {
      query.timestamp = { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      };
    }

    query.status = 'completed';

    // Execute query
    const payments = await Payment.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('splitId', 'name owner')
      .lean();

    const total = await Payment.countDocuments(query);

    // Get token details
    const tokens = await Payment.distinct('token', query);
    
    // Calculate totals
    const totalAmount = await Payment.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    res.json({
      success: true,
      data: {
        payments,
        summary: {
          totalPayments: total,
          totalAmount: totalAmount[0]?.total || 0,
          tokens: tokens,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum
        }
      }
    });

  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/payment/link/:linkId
 * @desc    Get payment link details
 * @access  Public
 */
router.get('/link/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;

    // In production, fetch from PaymentLink collection
    // For demo, return mock data
    
    // Check if payment link exists and is active
    const mockPaymentLink = {
      linkId,
      title: 'Team Payment Split',
      description: 'Payment will be distributed among team members',
      amount: 1000,
      currency: 'USDC',
      contractAddress: '0x...',
      isActive: true,
      createdBy: '0x...',
      createdAt: new Date('2024-01-15'),
      usageCount: 42,
      totalAmount: 42000
    };

    res.json({
      success: true,
      data: mockPaymentLink
    });

  } catch (error) {
    console.error('Error fetching payment link:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/payment/stats
 * @desc    Get platform payment statistics
 * @access  Public
 */
router.get('/stats', async (req, res) => {
  try {
    const { period = '30d' } = req.query; // 7d, 30d, 90d, 1y, all
    
    const now = new Date();
    let startDate;
    
    switch (period) {
      case '7d':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case '30d':
        startDate = new Date(now.setDate(now.getDate() - 30));
        break;
      case '90d':
        startDate = new Date(now.setDate(now.getDate() - 90));
        break;
      case '1y':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(0); // Beginning of time
    }

    // Platform-wide stats
    const totalStats = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          uniquePayers: { $addToSet: "$payerAddress" },
          uniqueSplits: { $addToSet: "$contractAddress" }
        }
      }
    ]);

    // Daily volume for chart
    const dailyVolume = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
          },
          date: { $first: "$timestamp" },
          count: { $sum: 1 },
          volume: { $sum: "$amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Token distribution
    const tokenDistribution = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: "$token",
          count: { $sum: 1 },
          volume: { $sum: "$amount" }
        }
      },
      { $sort: { volume: -1 } }
    ]);

    const stats = totalStats[0] || {
      totalPayments: 0,
      totalAmount: 0,
      uniquePayers: [],
      uniqueSplits: []
    };

    res.json({
      success: true,
      data: {
        period,
        startDate,
        totalPayments: stats.totalPayments,
        totalVolume: stats.totalAmount,
        uniquePayers: stats.uniquePayers?.length || 0,
        uniqueSplits: stats.uniqueSplits?.length || 0,
        dailyVolume,
        tokenDistribution,
        avgPaymentSize: stats.totalPayments > 0 ? stats.totalAmount / stats.totalPayments : 0
      }
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/payment/verify/:txHash
 * @desc    Verify a payment transaction
 * @access  Public
 */
router.get('/verify/:txHash', async (req, res) => {
  try {
    const { txHash } = req.params;

    // Check database first
    const payment = await Payment.findOne({ txHash })
      .populate('splitId', 'name owner recipients');

    if (payment) {
      return res.json({
        success: true,
        data: payment,
        source: 'database'
      });
    }

    // If not in database, check blockchain
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return res.status(404).json({ 
          success: false, 
          error: 'Transaction not found' 
        });
      }

      // Parse logs to extract payment info
      // This is simplified - you'd need to parse based on your contract ABI
      
      res.json({
        success: true,
        data: {
          txHash,
          blockNumber: receipt.blockNumber,
          status: receipt.status === 1 ? 'completed' : 'failed',
          confirmations: await provider.getBlockNumber() - receipt.blockNumber,
          from: receipt.from,
          to: receipt.to,
          logs: receipt.logs.length
        },
        source: 'blockchain'
      });

    } catch (blockchainError) {
      res.status(404).json({ 
        success: false, 
        error: 'Transaction not found on blockchain' 
      });
    }

  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;
