import cron from 'node-cron';
import mongoose from 'mongoose';
import Split from '../models/Split.js';
import ContractService from '../services/contractService.js';
import PaymentService from '../services/paymentService.js';

class AutoDistributeCron {
  constructor() {
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      totalRuns: 0,
      totalDistributions: 0,
      totalAmount: 0,
      lastSuccess: null,
      lastError: null
    };
  }
  
  /**
   * Start the cron job
   */
  start() {
    console.log('🚀 Starting auto-distribution cron job...');
    
    // Schedule to run every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.runDistributionCycle();
    });
    
    // Schedule daily stats cleanup
    cron.schedule('0 0 * * *', async () => {
      await this.cleanupOldStats();
    });
    
    // Schedule weekly report
    cron.schedule('0 9 * * 1', async () => {
      await this.generateWeeklyReport();
    });
    
    console.log('✅ Auto-distribution cron job scheduled');
  }
  
  /**
   * Run distribution cycle
   */
  async runDistributionCycle() {
    if (this.isRunning) {
      console.log('⚠️ Distribution cycle already running, skipping...');
      return;
    }
    
    this.isRunning = true;
    this.stats.totalRuns++;
    
    try {
      console.log(`🔄 Starting distribution cycle #${this.stats.totalRuns} at ${new Date().toISOString()}`);
      
      // Find splits eligible for auto-distribution
      const eligibleSplits = await this.getEligibleSplits();
      
      console.log(`📊 Found ${eligibleSplits.length} eligible splits`);
      
      let distributions = 0;
      let totalAmount = 0;
      
      // Process each split
      for (const split of eligibleSplits) {
        try {
          const result = await this.processSplitDistribution(split);
          
          if (result.success) {
            distributions++;
            totalAmount += result.amount;
            
            console.log(`✅ Distributed ${result.amount} from ${split.contractAddress}`);
          }
          
          // Small delay to avoid rate limiting
          await this.sleep(1000);
          
        } catch (error) {
          console.error(`❌ Failed to distribute for ${split.contractAddress}:`, error.message);
          
          // Mark split as problematic
          await this.markSplitAsProblematic(split, error.message);
        }
      }
      
      // Update stats
      this.stats.totalDistributions += distributions;
      this.stats.totalAmount += totalAmount;
      this.stats.lastSuccess = new Date();
      
      console.log(`🎉 Distribution cycle completed: ${distributions} distributions, ${totalAmount} total amount`);
      
    } catch (error) {
      console.error('❌ Distribution cycle failed:', error);
      this.stats.lastError = {
        timestamp: new Date(),
        message: error.message
      };
    } finally {
      this.isRunning = false;
      this.lastRun = new Date();
    }
  }
  
  /**
   * Get eligible splits for auto-distribution
   */
  async getEligibleSplits() {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      return await Split.find({
        active: true,
        autoDistribute: true,
        $or: [
          { lastDistribution: { $lt: oneHourAgo } },
          { lastDistribution: { $exists: false } }
        ]
      }).limit(50); // Limit to prevent overloading
      
    } catch (error) {
      console.error('Error getting eligible splits:', error);
      return [];
    }
  }
  
  /**
   * Process distribution for a single split
   */
  async processSplitDistribution(split) {
    try {
      // Check contract balance
      const balanceInfo = await ContractService.checkBalance(split.contractAddress);
      const balance = parseFloat(balanceInfo.balance);
      
      // Check if balance meets threshold
      if (balance < split.distributionThreshold) {
        return {
          success: false,
          reason: 'Balance below threshold',
          balance,
          threshold: split.distributionThreshold
        };
      }
      
      // Distribute funds
      const result = await ContractService.distributeFunds(
        split.contractAddress,
        balance.toString()
      );
      
      // Update split record
      split.totalDistributed += balance;
      split.lastDistribution = new Date();
      split.distributions.push({
        txHash: result.txHash,
        amount: balance,
        triggeredBy: 'auto',
        timestamp: new Date()
      });
      
      await split.save();
      
      // Send notification
      await PaymentService.sendPaymentNotification(
        {
          splitId: split._id,
          amount: balance,
          txHash: result.txHash,
          timestamp: new Date()
        },
        'auto_distribution'
      );
      
      return {
        success: true,
        amount: balance,
        txHash: result.txHash,
        distributions: result.distributions
      };
      
    } catch (error) {
      console.error(`Error processing distribution for ${split.contractAddress}:`, error);
      throw error;
    }
  }
  
  /**
   * Mark split as problematic
   */
  async markSplitAsProblematic(split, error) {
    try {
      // Increment error count or disable auto-distribute after too many failures
      split.autoDistribute = false;
      split.metadata = {
        ...split.metadata,
        lastError: error,
        errorTimestamp: new Date(),
        errorCount: (split.metadata?.errorCount || 0) + 1
      };
      
      await split.save();
      
      console.log(`⚠️ Disabled auto-distribute for ${split.contractAddress} due to errors`);
      
    } catch (dbError) {
      console.error('Error marking split as problematic:', dbError);
    }
  }
  
  /**
   * Cleanup old stats
   */
  async cleanupOldStats() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Cleanup old failed payments
      
        status: 'failed',
        timestamp: { $lt: thirtyDaysAgo }
      });
      
      // Cleanup old logs
      
        timestamp: { $lt: thirtyDaysAgo }
      });
      
      console.log('🧹 Cleaned up old stats and logs');
      
    } catch (error) {
      console.error('Error cleaning up old stats:', error);
    }
  }
  
  /**
   * Generate weekly report
   */
  async generateWeeklyReport() {
    try {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      const stats = await PaymentService.getPaymentStats('7d');
      
      // Generate report (could be email, webhook, or stored in database)
      const report = {
        period: 'weekly',
        startDate: oneWeekAgo,
        endDate: new Date(),
        distributions: this.stats,
        platformStats: stats,
        timestamp: new Date()
      };
      
      // Store report in database
      
      
      console.log('📈 Generated weekly report');
      
      // Send report to admin (implement based on your needs)
      await this.sendAdminReport(report);
      
    } catch (error) {
      console.error('Error generating weekly report:', error);
    }
  }
  
  /**
   * Send admin report
   */
  async sendAdminReport(report) {
    // Implement email, webhook, or other notification method
    console.log('Would send admin report:', {
      period: report.period,
      distributions: report.distributions.totalDistributions,
      amount: report.distributions.totalAmount
    });
  }
  
  /**
   * Get cron job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      stats: this.stats,
      nextRun: this.getNextRunTime()
    };
  }
  
  /**
   * Get next run time
   */
  getNextRunTime() {
    const now = new Date();
    const nextRun = new Date(now);
    
    // Next run in 5 minutes
    nextRun.setMinutes(nextRun.getMinutes() + 5);
    
    return nextRun;
  }
  
  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Manual trigger for testing
   */
  async manualTrigger() {
    console.log('🔧 Manual trigger requested');
    await this.runDistributionCycle();
  }
}

// Create singleton instance
const autoDistributeCron = new AutoDistributeCron();

// Export for use in server.js
export default autoDistributeCron;

// If this file is run directly, start the cron job
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      // Connect to MongoDB
      
      console.log('✅ Connected to MongoDB');
      
      // Start cron job
      autoDistributeCron.start();
      
      // Keep process alive
      process.on('SIGINT', () => {
        console.log('👋 Shutting down cron job...');
        process.exit(0);
      });
      
    } catch (error) {
      console.error('❌ Failed to start cron job:', error);
      process.exit(1);
    }
  })();
}
