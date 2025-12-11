import dotenv from "dotenv";
dotenv.config();
import express from 'express';
import { ethers } from 'ethers';
import Joi from 'joi';
import Split from '../models/Split.js';
import { validateRequest } from '../middleware/validation.js';

const router = express.Router();

// Joi validation schemas
const createSplitSchema = Joi.object({
  name: Joi.string().max(100).optional(),
  recipients: Joi.array().items(
    Joi.object({
      address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
      percentage: Joi.number().min(0.01).max(100).required(),
      name: Joi.string().max(50).optional()
    })
  ).min(1).max(20).required(),
  token: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  autoDistribute: Joi.boolean().default(false),
  notificationEmail: Joi.string().email().optional()
});

const updateSplitSchema = Joi.object({
  recipients: Joi.array().items(
    Joi.object({
      address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
      percentage: Joi.number().min(0.01).max(100).required()
    })
  ).min(1).max(20),
  active: Joi.boolean(),
  autoDistribute: Joi.boolean()
});

// Connect to Tempo network
// Provider
const provider = new ethers.JsonRpcProvider(process.env.TEMPO_RPC_URL, {
  name: "tempo-testnet",
  chainId: 42429
});
// Validate private key
const PRIVATE_KEY = (process.env.PRIVATE_KEY || "").trim();

if (!PRIVATE_KEY.startsWith("0x") || PRIVATE_KEY.length !== 66) {
  console.error("❌ INVALID PRIVATE KEY LOADED:", PRIVATE_KEY);
  throw new Error("Invalid PRIVATE_KEY in .env file");
}

// Wallet
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
// ABI for SplitFactory
const FACTORY_ABI = [
  "function createSplitter(address[] recipients, uint256[] shares, address token) external returns (address)",
  "function getUserSplitters(address user) external view returns (address[] memory)",
  "event SplitterCreated(address indexed owner, address splitterAddress, address[] recipients, uint256[] shares, address token)"
];

const factory = new ethers.Contract(
  process.env.CONTRACT_FACTORY_ADDRESS,
  FACTORY_ABI,
  wallet
);

/**
 * @route   POST /api/split/create
 * @desc    Create a new split contract
 * @access  Private (requires signature)
 */
router.post('/create', validateRequest(createSplitSchema), async (req, res) => {
  try {
    const { name, recipients, token, autoDistribute, notificationEmail } = req.body;
    const userAddress = req.headers['x-wallet-address'];
    const signature = req.headers['x-signature'];

    // Verify signature (in production, implement proper verification)
    // For now, we'll trust the header

    // Convert percentages to basis points
    const recipientAddresses = recipients.map(r => r.address);
    const shares = recipients.map(r => Math.round(r.percentage * 100)); // Convert % to basis points

    // Deploy splitter contract
    const tx = await factory.createSplitter(recipientAddresses, shares, token);
    const receipt = await tx.wait();

    // Extract contract address from event
    const event = receipt.logs.find(log => 
      log.fragment && log.fragment.name === 'SplitterCreated'
    );

    if (!event) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to extract contract address' 
      });
    }

    const splitterAddress = event.args[1];

    // Save to database
    const newSplit = new Split({
      name: name || `Split ${Date.now()}`,
      contractAddress: splitterAddress,
      owner: userAddress,
      recipients: recipients.map((r, i) => ({
        address: r.address,
        percentage: r.percentage,
        name: r.name || `Recipient ${i + 1}`,
        share: shares[i]
      })),
      token,
      autoDistribute,
      notificationEmail,
      createdTx: tx.hash,
      createdAt: new Date()
    });

    await newSplit.save();

    res.status(201).json({
      success: true,
      message: 'Split contract created successfully',
      data: {
        splitId: newSplit._id,
        contractAddress: splitterAddress,
        txHash: tx.hash,
        recipients: newSplit.recipients,
        explorerUrl: `${process.env.BLOCK_EXPLORER_URL}/tx/${tx.hash}`
      }
    });

  } catch (error) {
    console.error('Error creating split:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create split contract' 
    });
  }
});

/**
 * @route   GET /api/split/user/:address
 * @desc    Get all splits for a user
 * @access  Public
 */
router.get('/user/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Get splits from database
    const dbSplits = await Split.find({ owner: address })
      .sort({ createdAt: -1 })
      .lean();

    // Get splits from blockchain
    const onchainSplitters = await factory.getUserSplitters(address);
    
    // Merge data
    const splits = dbSplits.map(split => ({
      ...split,
      onChain: onchainSplitters.includes(split.contractAddress)
    }));

    res.json({
      success: true,
      data: {
        splits,
        total: splits.length,
        onChainCount: onchainSplitters.length
      }
    });

  } catch (error) {
    console.error('Error fetching user splits:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/split/:address
 * @desc    Get split details by contract address
 * @access  Public
 */
router.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;

    // Get from database
    const split = await Split.findOne({ contractAddress: address });
    
    if (!split) {
      return res.status(404).json({ 
        success: false, 
        error: 'Split contract not found' 
      });
    }

    // Get on-chain data
    const SPLITTER_ABI = [
      "function getConfig() view returns (tuple(address[] recipients, uint256[] shares, address token, address owner, bool active))",
      "function getTotalDistributed() view returns (uint256)",
      "function getBalance() view returns (uint256)"
    ];

    const splitterContract = new ethers.Contract(
      address,
      SPLITTER_ABI,
      provider
    );

    const [config, totalDistributed, balance] = await Promise.all([
      splitterContract.getConfig(),
      splitterContract.getTotalDistributed(),
      splitterContract.getBalance()
    ]);

    res.json({
      success: true,
      data: {
        ...split.toObject(),
        onChainConfig: {
          recipients: config.recipients,
          shares: config.shares,
          token: config.token,
          owner: config.owner,
          active: config.active
        },
        totalDistributed: ethers.formatUnits(totalDistributed, 6),
        balance: ethers.formatUnits(balance, 6)
      }
    });

  } catch (error) {
    console.error('Error fetching split details:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   PUT /api/split/:address
 * @desc    Update split configuration
 * @access  Private
 */
router.put('/:address', validateRequest(updateSplitSchema), async (req, res) => {
  try {
    const { address } = req.params;
    const { recipients, active, autoDistribute } = req.body;
    const userAddress = req.headers['x-wallet-address'];

    // Get split
    const split = await Split.findOne({ 
      contractAddress: address,
      owner: userAddress 
    });

    if (!split) {
      return res.status(404).json({ 
        success: false, 
        error: 'Split contract not found or unauthorized' 
      });
    }

    // Update database
    const updates = {};
    if (recipients) {
      const shares = recipients.map(r => Math.round(r.percentage * 100));
      updates.recipients = recipients.map((r, i) => ({
        address: r.address,
        percentage: r.percentage,
        share: shares[i]
      }));
    }
    if (active !== undefined) updates.active = active;
    if (autoDistribute !== undefined) updates.autoDistribute = autoDistribute;

    const updatedSplit = await Split.findByIdAndUpdate(
      split._id,
      updates,
      { new: true }
    );

    res.json({
      success: true,
      message: 'Split updated successfully',
      data: updatedSplit
    });

  } catch (error) {
    console.error('Error updating split:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   DELETE /api/split/:address
 * @desc    Deactivate a split (soft delete)
 * @access  Private
 */
router.delete('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const userAddress = req.headers['x-wallet-address'];

    const split = await Split.findOne({ 
      contractAddress: address,
      owner: userAddress 
    });

    if (!split) {
      return res.status(404).json({ 
        success: false, 
        error: 'Split contract not found or unauthorized' 
      });
    }

    // Soft delete - mark as inactive
    await Split.findByIdAndUpdate(split._id, { 
      active: false,
      deactivatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Split deactivated successfully'
    });

  } catch (error) {
    console.error('Error deactivating split:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/split/:address/payments
 * @desc    Get payment history for a split
 * @access  Public
 */
router.get('/:address/payments', async (req, res) => {
  try {
    const { address } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // In production, query from indexed blockchain data or database
    // For now, return mock/stub data
    res.json({
      success: true,
      data: {
        payments: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0
        }
      }
    });

  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   POST /api/split/:address/distribute
 * @desc    Manually trigger distribution
 * @access  Private
 */
router.post('/:address/distribute', async (req, res) => {
  try {
    const { address } = req.params;
    const userAddress = req.headers['x-wallet-address'];
    const { amount } = req.body;

    // Verify ownership
    const split = await Split.findOne({ 
      contractAddress: address,
      owner: userAddress 
    });

    if (!split) {
      return res.status(403).json({ 
        success: false, 
        error: 'Unauthorized' 
      });
    }

    // ABI for distribution
    const SPLITTER_ABI = [
      "function distribute(uint256 amount) external"
    ];

    const splitterContract = new ethers.Contract(
      address,
      SPLITTER_ABI,
      wallet
    );

    const amountWei = ethers.parseUnits(amount.toString(), 6);
    const tx = await splitterContract.distribute(amountWei);
    await tx.wait();

    // Log distribution
    await Split.findByIdAndUpdate(split._id, {
      $push: {
        distributions: {
          txHash: tx.hash,
          amount: amount,
          timestamp: new Date(),
          triggeredBy: 'manual'
        }
      },
      lastDistribution: new Date()
    });

    res.json({
      success: true,
      message: 'Distribution executed successfully',
      data: {
        txHash: tx.hash,
        explorerUrl: `${process.env.BLOCK_EXPLORER_URL}/tx/${tx.hash}`
      }
    });

  } catch (error) {
    console.error('Error distributing:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @route   POST /api/split/:address/generate-link
 * @desc    Generate payment link for a split
 * @access  Private
 */
router.post('/:address/generate-link', async (req, res) => {
  try {
    const { address } = req.params;
    const userAddress = req.headers['x-wallet-address'];
    const { title, description, amount, redirectUrl } = req.body;

    // Verify ownership
    const split = await Split.findOne({ 
      contractAddress: address,
      owner: userAddress 
    });

    if (!split) {
      return res.status(403).json({ 
        success: false, 
        error: 'Unauthorized' 
      });
    }

    // Generate unique payment link ID
    const linkId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const paymentLink = {
      linkId,
      title: title || `Payment to ${split.name}`,
      description: description || 'Split payment',
      amount: amount || null,
      contractAddress: address,
      redirectUrl: redirectUrl || null,
      createdBy: userAddress,
      createdAt: new Date(),
      isActive: true,
      usageCount: 0,
      totalAmount: 0
    };

    // Save payment link (in production, save to database)
    // For now, return the link

    res.json({
      success: true,
      data: {
        paymentLink: `https://${req.headers.host}/pay/${linkId}`,
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://${req.headers.host}/pay/${linkId}`,
        details: paymentLink
      }
    });

  } catch (error) {
    console.error('Error generating payment link:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;
