// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Splitter.sol";
import "./interfaces/ISplitter.sol";

contract SplitFactory {
    address[] public allSplitters;
    mapping(address => address[]) public userSplitters;
    
    event SplitterCreated(
        address indexed owner,
        address splitterAddress,
        address[] recipients,
        uint256[] shares,
        address token
    );
    
    function createSplitter(
        address[] memory recipients,
        uint256[] memory shares,
        address token
    ) external returns (address) {
        require(recipients.length == shares.length, "Arrays length mismatch");
        require(recipients.length > 0, "No recipients");
        
        uint256 totalShares = 0;
        for (uint256 i = 0; i < shares.length; i++) {
            totalShares += shares[i];
        }
        require(totalShares == 10000, "Shares must sum to 10000 (100%)");
        
        Splitter newSplitter = new Splitter(
            recipients,
            shares,
            token,
            msg.sender
        );
        
        address splitterAddress = address(newSplitter);
        allSplitters.push(splitterAddress);
        userSplitters[msg.sender].push(splitterAddress);
        
        emit SplitterCreated(
            msg.sender,
            splitterAddress,
            recipients,
            shares,
            token
        );
        
        return splitterAddress;
    }
    
    function getUserSplitters(address user) external view returns (address[] memory) {
        return userSplitters[user];
    }
    
    function getAllSplitters() external view returns (address[] memory) {
        return allSplitters;
    }
}
