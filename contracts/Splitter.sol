// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IERC20.sol";
import "./interfaces/ISplitter.sol";

contract Splitter is ISplitter {
    address[] public recipients;
    uint256[] public shares; // in basis points (10000 = 100%)
    address public token;
    address public owner;
    bool public active = true;
    
    uint256 public totalDistributed;
    uint256 private constant BASIS_POINTS = 10000;
    
    event PaymentReceived(address indexed payer, uint256 amount, address token);
    event Distributed(address indexed recipient, uint256 amount);
    event SharesUpdated(address[] recipients, uint256[] shares);
    event EmergencyWithdrawn(address indexed owner, uint256 amount);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    constructor(
        address[] memory _recipients,
        uint256[] memory _shares,
        address _token,
        address _owner
    ) {
        require(_recipients.length == _shares.length, "Arrays length mismatch");
        require(_recipients.length > 0, "No recipients");
        
        uint256 totalShares = 0;
        for (uint256 i = 0; i < _shares.length; i++) {
            require(_shares[i] > 0, "Share cannot be zero");
            totalShares += _shares[i];
        }
        require(totalShares == BASIS_POINTS, "Shares must sum to 10000");
        
        recipients = _recipients;
        shares = _shares;
        token = _token;
        owner = _owner;
    }
    
    function distribute(uint256 amount) external {
        require(active, "Splitter is not active");
        require(amount > 0, "Amount must be greater than 0");
        
        IERC20 paymentToken = IERC20(token);
        require(
            paymentToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        emit PaymentReceived(msg.sender, amount, token);
        
        uint256 remainingAmount = amount;
        
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 shareAmount = (amount * shares[i]) / BASIS_POINTS;
            
            if (i == recipients.length - 1) {
                // Last recipient gets remaining amount to avoid rounding errors
                shareAmount = remainingAmount;
            } else {
                remainingAmount -= shareAmount;
            }
            
            require(
                paymentToken.transfer(recipients[i], shareAmount),
                "Transfer to recipient failed"
            );
            
            emit Distributed(recipients[i], shareAmount);
        }
        
        totalDistributed += amount;
    }
    
    function updateShares(
        address[] memory newRecipients,
        uint256[] memory newShares
    ) external onlyOwner {
        require(newRecipients.length == newShares.length, "Arrays length mismatch");
        require(newRecipients.length > 0, "No recipients");
        
        uint256 totalShares = 0;
        for (uint256 i = 0; i < newShares.length; i++) {
            require(newShares[i] > 0, "Share cannot be zero");
            totalShares += newShares[i];
        }
        require(totalShares == BASIS_POINTS, "Shares must sum to 10000");
        
        recipients = newRecipients;
        shares = newShares;
        
        emit SharesUpdated(newRecipients, newShares);
    }
    
    function emergencyWithdraw() external onlyOwner {
        require(!active, "Must deactivate first");
        
        IERC20 paymentToken = IERC20(token);
        uint256 balance = paymentToken.balanceOf(address(this));
        
        if (balance > 0) {
            require(
                paymentToken.transfer(owner, balance),
                "Emergency withdrawal failed"
            );
            emit EmergencyWithdrawn(owner, balance);
        }
    }
    
    function deactivate() external onlyOwner {
        active = false;
    }
    
    function activate() external onlyOwner {
        active = true;
    }
    
    function getConfig() external view returns (SplitConfig memory) {
        return SplitConfig({
            recipients: recipients,
            shares: shares,
            token: token,
            owner: owner,
            active: active
        });
    }
    
    function getTotalDistributed() external view returns (uint256) {
        return totalDistributed;
    }
    
    function getBalance() external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
