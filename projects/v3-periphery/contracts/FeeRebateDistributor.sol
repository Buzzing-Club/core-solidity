// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

interface IFeeAdapterTransparent {
    function claimFee(address token) external;
    function getFee(address user, address token) external view returns (uint256);
}

/// @notice Distributes fee rebates to users, topping up from FeeAdapterTransparent when needed.
contract FeeRebateDistributor {
    address public owner;
    address public feeAdapter;
    mapping(address => bool) public auth;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeAdapterUpdated(address indexed previousAdapter, address indexed newAdapter);
    event AuthUpdated(address indexed account, bool allowed);
    event FeeAdapterClaimed(address indexed token, uint256 amount);
    event RebatePaid(address indexed token, address indexed to, uint256 amount);
    event ReferFeePaid(address indexed token, address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAuth() {
        require(auth[msg.sender], "Not auth");
        _;
    }

    constructor(address _feeAdapter) {
        require(_feeAdapter != address(0), "Invalid fee adapter");
        owner = msg.sender;
        feeAdapter = _feeAdapter;
        auth[msg.sender] = true;
        emit AuthUpdated(msg.sender, true);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setFeeAdapter(address newAdapter) external onlyOwner {
        require(newAdapter != address(0), "Invalid fee adapter");
        emit FeeAdapterUpdated(feeAdapter, newAdapter);
        feeAdapter = newAdapter;
    }

    function setAuth(address account, bool allowed) external onlyOwner {
        require(account != address(0), "Invalid account");
        auth[account] = allowed;
        emit AuthUpdated(account, allowed);
    }

    function revokeAuth(address account) external onlyOwner {
        require(account != address(0), "Invalid account");
        auth[account] = false;
        emit AuthUpdated(account, false);
    }

    /// @notice Pay rebate to a user. If balance is insufficient, claim from fee adapter.
    function distribute(address token, address to, uint256 amount) external onlyAuth {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");

        _claimIfNeeded(token, amount);
        _safeTransfer(token, to, amount);
        emit RebatePaid(token, to, amount);
    }

    /// @notice Pay refer fee to a user. Same transfer path as distribute, with dedicated event.
    function referFeeDistribute(address token, address to, uint256 amount) external onlyAuth {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");

        _claimIfNeeded(token, amount);
        _safeTransfer(token, to, amount);
        emit ReferFeePaid(token, to, amount);
    }

    /// @notice Batch pay refer fee. Claims once when needed, then pays recipients one by one.
    function referFeeDistributeBatch(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyAuth {
        uint256 len = recipients.length;
        require(len > 0, "Empty batch");
        require(len == amounts.length, "Length mismatch");

        uint256 total;
        for (uint256 i = 0; i < len; i++) {
            require(recipients[i] != address(0), "Invalid recipient");
            require(amounts[i] > 0, "Invalid amount");
            total += amounts[i];
        }

        _claimIfNeeded(token, total);

        for (uint256 i = 0; i < len; i++) {
            _safeTransfer(token, recipients[i], amounts[i]);
            emit ReferFeePaid(token, recipients[i], amounts[i]);
        }
    }

    function _claimIfNeeded(address token, uint256 amount) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal >= amount) return;

        uint256 pending = IFeeAdapterTransparent(feeAdapter).getFee(address(this), token);
        if (pending > 0) {
            IFeeAdapterTransparent(feeAdapter).claimFee(token);
            emit FeeAdapterClaimed(token, pending);
        }

        bal = IERC20(token).balanceOf(address(this));
        require(bal >= amount, "Insufficient fee balance");
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ST");
    }
}
