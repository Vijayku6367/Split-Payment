import { ethers } from 'ethers';
import Payment from '../models/Payment.js';
import Split from '../models/Split.js';
import User from '../models/User.js';
import ContractService from './contractService.js';
import axios from 'axios';

class PaymentService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.TEMPO_RPC_URL);
  }
  
  /**
   * Create payment record
   */
  async createPaymentRecord(data) {
    try {
      const payment = new Payment({
        ...data,
        status: 'pending'
      });
      
      await payment.save();
      return payment;
      
    } catch (error) {
      console.error('Error creating payment record:', error);
      throw new Error(`Failed to create payment record: ${error.message}`);
    }
  }
  
  /**
   * Update payment status
   */
  async updatePaymentStatus(txHash, status, txData = {}) {
    try {
      const payment = await Payment.findOne({ txHash });
      
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      payment.status = status;
      
      if (status === 'completed') {
        payment.blockNumber = txData.blockNumber;
        payment.blockHash = txData.blockHash;
        payment.gasUsed = txData.gasUsed?.toString();
        payment.gasPrice = txData.gasPrice?.toString();
        payment.confirmedAt = new Date();
        
        // Update split statistics
        const split = await Split.findById(payment.splitId);
        if (split) {
          split.totalPayments += 1;
          split.totalAmount += payment.amount;
          split.lastPayment = new Date();
          await split.save();
        }
      } else if (status === 'failed') {
        payment.error = txData.error;
      }
      
      await payment.save();
      return payment;
      
    } catch (error) {
      console.error('Error updating payment status:', error);
      throw new Error(`Failed to update payment status: ${error.message}`);
    }
  }
  
  /**
   * Get payment history
   */
  async getPaymentHistory(filters = {}) {
    try {
      const {
        address,
        type = 'all',
        token,
        startDate,
        endDate,
        page = 1,
        limit = 20
      } = filters;
      
      const query = {};
      const skip = (page - 1) * limit;
      
      // Build query based on type
      if (type === 'sent') {
        query.payerAddress = address.toLowerCase();
      } else if (type === 'received') {
        // Find splits owned by address
        const splits = await Split.find({ owner: address.toLowerCase() });
        const splitIds = splits.map(s => s._id);
        query.splitId = { $in: splitIds };
      } else if (type === 'split') {
        const split = await Split.findOne({ contractAddress: address.toLowerCase() });
        if (split) {
          query.splitId = split._id;
        }
      } else if (type === 'recipient') {
        query['distributions.recipient'] = address.toLowerCase();
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
      
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }
      
      query.status = 'completed';
      
      // Execute query
      const payments = await Payment.find(query)
        .populate('splitId', 'name owner')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit);
      
      const total = await Payment.countDocuments(query);
      
      // Calculate totals
      const totalAmount = await Payment.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);
      
      return {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
          totalAmount: totalAmount[0]?.total || 0
        }
      };
      
    } catch (error) {
      console.error('Error getting payment history:', error);
      throw new Error(`Failed to get payment history: ${error.message}`);
    }
  }
  
  /**
   * Get payment statistics
   */
  async getPaymentStats(period = '30d') {
    try {
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
          startDate = new Date(0);
      }
      
      // Platform stats
      const platformStats = await Payment.aggregate([
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
            totalVolume: { $sum: "$amount" },
            avgPayment: { $avg: "$amount" },
            uniquePayers: { $addToSet: "$payerAddress" },
            uniqueSplits: { $addToSet: "$contractAddress" }
          }
        }
      ]);
      
      // Daily volume
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
            tokenSymbol: { $first: "$tokenSymbol" },
            count: { $sum: 1 },
            volume: { $sum: "$amount" },
            avgAmount: { $avg: "$amount" }
          }
        },
        { $sort: { volume: -1 } }
      ]);
      
      const stats = platformStats[0] || {
        totalPayments: 0,
        totalVolume: 0,
        avgPayment: 0,
        uniquePayers: [],
        uniqueSplits: []
      };
      
      return {
        period,
        startDate,
        endDate: new Date(),
        totalPayments: stats.totalPayments,
        totalVolume: stats.totalVolume,
        avgPayment: stats.avgPayment,
        uniquePayers: stats.uniquePayers?.length || 0,
        uniqueSplits: stats.uniqueSplits?.length || 0,
        dailyVolume,
        tokenDistribution,
        topPayments: await this.getTopPayments(10, startDate)
      };
      
    } catch (error) {
      console.error('Error getting payment stats:', error);
      throw new Error(`Failed to get payment stats: ${error.message}`);
    }
  }
  
  /**
   * Get top payments
   */
  async getTopPayments(limit = 10, startDate = null) {
    try {
      const match = { status: 'completed' };
      if (startDate) {
        match.timestamp = { $gte: startDate };
      }
      
      return Payment.find(match)
        .populate('splitId', 'name')
        .sort({ amount: -1 })
        .limit(limit);
        
    } catch (error) {
      console.error('Error getting top payments:', error);
      return [];
    }
  }
  
  /**
   * Generate payment report
   */
  async generatePaymentReport(splitId, format = 'json') {
    try {
      const split = await Split.findById(splitId);
      
      if (!split) {
        throw new Error('Split not found');
      }
      
      const payments = await Payment.find({ splitId })
        .sort({ timestamp: -1 });
      
      // Calculate summary
      const summary = {
        totalPayments: payments.length,
        totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
        firstPayment: payments[payments.length - 1]?.timestamp,
        lastPayment: payments[0]?.timestamp,
        uniquePayers: [...new Set(payments.map(p => p.payerAddress))],
        
        // Recipient distribution
        recipientSummary: split.recipients.map(recipient => {
          const recipientPayments = payments.filter(p => 
            p.distributions.some(d => 
              d.recipient.toLowerCase() === recipient.address.toLowerCase()
            )
          );
          
          const totalReceived = recipientPayments.reduce((sum, p) => {
            const distribution = p.distributions.find(d => 
              d.recipient.toLowerCase() === recipient.address.toLowerCase()
            );
            return sum + (distribution?.amount || 0);
          }, 0);
          
          return {
            address: recipient.address,
            name: recipient.name,
            percentage: recipient.percentage,
            totalReceived,
            paymentCount: recipientPayments.length
          };
        })
      };
      
      if (format === 'csv') {
        return this.generateCSVReport(payments, summary);
      } else if (format === 'pdf') {
        return this.generatePDFReport(split, payments, summary);
      }
      
      return {
        split: {
          name: split.name,
          contractAddress: split.contractAddress,
          owner: split.owner,
          token: split.tokenSymbol
        },
        summary,
        payments: payments.map(p => ({
          txHash: p.txHash,
          payer: p.payerAddress,
          amount: p.amount,
          timestamp: p.timestamp,
          distributions: p.distributions
        }))
      };
      
    } catch (error) {
      console.error('Error generating payment report:', error);
      throw new Error(`Failed to generate payment report: ${error.message}`);
    }
  }
  
  /**
   * Generate CSV report
   */
  generateCSVReport(payments, summary) {
    let csv = 'Transaction Hash,Payer,Amount,Timestamp,Recipients\n';
    
    payments.forEach(payment => {
      const recipients = payment.distributions
        .map(d => `${d.recipient}: ${d.amount}`)
        .join('; ');
      
      csv += `"${payment.txHash}","${payment.payerAddress}",${payment.amount},"${payment.timestamp}","${recipients}"\n`;
    });
    
    return csv;
  }
  
  /**
   * Generate PDF report (stub - implement with PDF library)
   */
  generatePDFReport(split, payments, summary) {
    // Implement with pdfkit or other PDF library
    return {
      message: 'PDF generation not implemented',
      data: { split, payments, summary }
    };
  }
  
  /**
   * Send payment notification
   */
  async sendPaymentNotification(payment, notificationType = 'payment_received') {
    try {
      const split = await Split.findById(payment.splitId);
      
      if (!split) {
        return;
      }
      
      // Email notification
      if (split.notificationSettings?.email) {
        await this.sendEmailNotification(split, payment, notificationType);
      }
      
      // Webhook notification
      if (split.notificationSettings?.webhook) {
        await this.sendWebhookNotification(split, payment, notificationType);
      }
      
      // In-app notification (store in database)
      await this.createInAppNotification(split, payment, notificationType);
      
    } catch (error) {
      console.error('Error sending payment notification:', error);
    }
  }
  
  /**
   * Send email notification
   */
  async sendEmailNotification(split, payment, type) {
    // Implement with nodemailer or email service
    console.log(`Would send ${type} email for split ${split._id}, payment ${payment._id}`);
  }
  
  /**
   * Send webhook notification
   */
  async sendWebhookNotification(split, payment, type) {
    try {
      const payload = {
        event: type,
        splitId: split._id,
        splitName: split.name,
        contractAddress: split.contractAddress,
        paymentId: payment._id,
        amount: payment.amount,
        token: payment.tokenSymbol,
        payer: payment.payerAddress,
        timestamp: payment.timestamp,
        txHash: payment.txHash
      };
      
      await axios.post(split.notificationSettings.webhook, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': this.generateWebhookSignature(payload)
        }
      });
      
    } catch (error) {
      console.error('Error sending webhook notification:', error);
    }
  }
  
  /**
   * Create in-app notification
   */
  async createInAppNotification(split, payment, type) {
    // Store notification in database for user to see in app
    // Implement based on your notification system
  }
  
  /**
   * Generate webhook signature
   */
  generateWebhookSignature(payload) {
    const secret = process.env.WEBHOOK_SECRET || 'default-secret';
    const crypto = require('crypto');
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
  }
  
  /**
   * Process batch payments
   */
  async processBatchPayments(payments, token) {
    const results = [];
    const errors = [];
    
    for (const payment of payments) {
      try {
        const result = await ContractService.distributeFunds(
          payment.splitAddress,
          payment.amount
        );
        
        results.push({
          splitAddress: payment.splitAddress,
          success: true,
          txHash: result.txHash,
          amount: payment.amount
        });
        
      } catch (error) {
        errors.push({
          splitAddress: payment.splitAddress,
          error: error.message,
          amount: payment.amount
        });
      }
    }
    
    return {
      processed: results.length,
      failed: errors.length,
      results,
      errors
    };
  }
  
  /**
   * Validate payment data
   */
  validatePaymentData(data) {
    const errors = [];
    
    if (!data.splitAddress || !ethers.isAddress(data.splitAddress)) {
      errors.push('Invalid split address');
    }
    
    if (!data.amount || isNaN(data.amount) || data.amount <= 0) {
      errors.push('Invalid amount');
    }
    
    if (!data.token || !ethers.isAddress(data.token)) {
      errors.push('Invalid token address');
    }
    
    if (!data.payer || !ethers.isAddress(data.payer)) {
      errors.push('Invalid payer address');
    }
    
    if (errors.length > 0) {
      throw new Error(`Payment validation failed: ${errors.join(', ')}`);
    }
    
    return true;
  }
}

export default new PaymentService();
