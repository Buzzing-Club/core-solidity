// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./openzeppelin-contracts-upgradeable/contracts/proxy/utils/Initializable.sol";
interface IERC20{
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function burn(address from, uint256 amount) external;
    function mint(address to, uint256 amount) external;
    function balanceOf(address to) external returns (uint256);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}
contract FeeAdapterTransparent is Initializable {
    address public owner;
    address public vault;

    uint256 public constant RATIO_SCALE = 1_000_000; // 100% = 1_000_000

    // pool => total fee ratio
    mapping(address => uint256) public poolTotalFeeRatio;

    // pool => role => share
    mapping(address => mapping(bytes32 => uint256)) public poolRoleShares;

    // pool => role => recipient
    mapping(address => mapping(bytes32 => address)) public poolRoleRecipients;

    // pool => list of fixed roles
    mapping(address => bytes32[]) public poolRoles;

    // pool => refer share
    mapping(address => uint256) public poolReferShare;

    // user => token => pending balance
    mapping(address => mapping(address => uint256)) public pendingBalances;

    /// @notice Emitted when a fee is recorded for a role or refer
    event FeeRecorded(address indexed user, bytes32 indexed role, uint256 amount, address pool);

    /// @notice Emitted when a user claims their fee
    event FeeClaimed(address indexed user, address indexed token, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers(); // Avoid initializing in the context of the implementation
    }
    /// @notice initialize function to replace constructor
    function initialize(address _vault) public initializer {
        require(_vault != address(0), "Invalid vault address");
        owner = msg.sender;
        vault = _vault;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "Not vault");
        _;
    }

    // ============ Admin Functions ============

    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "Invalid vault address");
        vault = newVault;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPoolTotalFeeRatio(address pool, uint256 ratio) external onlyOwner {
        require(ratio <= RATIO_SCALE, "Invalid total ratio");
        poolTotalFeeRatio[pool] = ratio;
    }

    function setPoolRole(
        address pool,
        bytes32 role,
        address recipient,
        uint256 share
    ) external onlyOwner {
        require(recipient != address(0), "Invalid address");
        require(share <= RATIO_SCALE, "Share too big");

        if (poolRoleShares[pool][role] == 0) {
            poolRoles[pool].push(role);
        }

        poolRoleShares[pool][role] = share;
        poolRoleRecipients[pool][role] = recipient;
    }

    function setPoolReferShare(address pool, uint256 share) external onlyOwner {
        require(share <= RATIO_SCALE, "Invalid refer share");
        poolReferShare[pool] = share;
    }

    function getPoolRoles(address pool) external view returns (bytes32[] memory) {
        return poolRoles[pool];
    }

    // ============ Called by Vault Only ============
    function _distributeRoleFee(
        address pool,
        address token,
        uint256 totalFeeAmount,
        uint256 totalRatio
    ) internal returns (uint256 totalFixed) {
        bytes32[] memory roles = poolRoles[pool];
        for (uint256 i = 0; i < roles.length; i++) {
            bytes32 role = roles[i];
            uint256 share = poolRoleShares[pool][role];
            totalFixed += share;

            address recipient = poolRoleRecipients[pool][role];
            uint256 amount = (totalFeeAmount * share) / totalRatio;

            pendingBalances[recipient][token] += amount;
            emit FeeRecorded(recipient, role, amount, pool);
        }
    }

    function recordFee(
        address pool,
        address refer,
        address token,
        uint256 totalFeeAmount
    ) external onlyVault {
        uint256 totalRatio = poolTotalFeeRatio[pool];
        uint256 referRatio = poolReferShare[pool];
        require(referRatio <= totalRatio, "Refer too large");

        uint256 totalFixed = _distributeRoleFee(pool, token, totalFeeAmount, totalRatio);
        require(totalFixed + referRatio == totalRatio, "Share sum mismatch");

        if (refer != address(0) && referRatio > 0) {
            uint256 referAmount = (totalFeeAmount * referRatio) / totalRatio;
            pendingBalances[refer][token] += referAmount;

            emit FeeRecorded(refer, "REFERRAL", referAmount, pool);
        }
        else {
            uint256 referAmount = (totalFeeAmount * referRatio) / totalRatio;
            pendingBalances[owner][token] += referAmount;

            emit FeeRecorded(owner, "REFERRAL", referAmount, pool);
        }
    }


    // ============ User Claim ============

    function claimFee(address token) external {
        uint256 amount = pendingBalances[msg.sender][token];
        require(amount > 0, "Nothing to claim");
        pendingBalances[msg.sender][token] = 0;
        IERC20(token).transfer(msg.sender, amount);

        emit FeeClaimed(msg.sender, token, amount);
    }

    function getFee(address user, address token) external view returns (uint256) {
        return pendingBalances[user][token];
    }
}
