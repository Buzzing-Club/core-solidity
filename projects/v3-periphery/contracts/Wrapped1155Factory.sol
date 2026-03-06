    // SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.0;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
// import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { ERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/ERC1155Receiver.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
/*
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with GSN meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address payable) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes memory) {
        this; // silence state mutability warning without generating bytecode - see https://github.com/ethereum/solidity/issues/2691
        return msg.data;
    }
}

// File: @openzeppelin/contracts@3.4.0/token/ERC20/IERC20.sol



pragma solidity >=0.6.0 <0.8.0;

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    /**
     * @dev Returns the amount of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the amount of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves `amount` tokens from the caller's account to `recipient`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 amount) external returns (bool);

    /**
     * @dev Moves `amount` tokens from `sender` to `recipient` using the
     * allowance mechanism. `amount` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

}
contract ERC20 is Context, IERC20 {
    using SafeMath for uint256;

    mapping (address => uint256) private _balances;

    mapping (address => mapping (address => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    /**
     * @dev Sets the values for {name} and {symbol}, initializes {decimals} with
     * a default value of 18.
     *
     * To select a different value for {decimals}, use {_setupDecimals}.
     *
     * All three of these values are immutable: they can only be set once during
     * construction.
     */
    constructor (string memory name_, string memory symbol_) public {
        _name = name_;
        _symbol = symbol_;
        _decimals = 6;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the value {ERC20} uses, unless {_setupDecimals} is
     * called.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual returns (uint8) {
        return _decimals;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * Requirements:
     *
     * - `sender` and `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     * - the caller must have allowance for ``sender``'s tokens of at least
     * `amount`.
     */
    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(sender, recipient, amount);
        _approve(sender, _msgSender(), _allowances[sender][_msgSender()].sub(amount, "ERC20: transfer amount exceeds allowance"));
        return true;
    }

    /**
     * @dev Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function increaseAllowance(address spender, uint256 addedValue) public virtual returns (bool) {
        _approve(_msgSender(), spender, _allowances[_msgSender()][spender].add(addedValue));
        return true;
    }

    /**
     * @dev Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least
     * `subtractedValue`.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public virtual returns (bool) {
        _approve(_msgSender(), spender, _allowances[_msgSender()][spender].sub(subtractedValue, "ERC20: decreased allowance below zero"));
        return true;
    }

    /**
     * @dev Moves tokens `amount` from `sender` to `recipient`.
     *
     * This is internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * Requirements:
     *
     * - `sender` cannot be the zero address.
     * - `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     */
    function _transfer(address sender, address recipient, uint256 amount) internal virtual {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(sender, recipient, amount);

        _balances[sender] = _balances[sender].sub(amount, "ERC20: transfer amount exceeds balance");
        _balances[recipient] = _balances[recipient].add(amount);
        emit Transfer(sender, recipient, amount);
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     */
    function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, amount);

        _totalSupply = _totalSupply.add(amount);
        _balances[account] = _balances[account].add(amount);
        emit Transfer(address(0), account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, reducing the
     * total supply.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     * - `account` must have at least `amount` tokens.
     */
    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(account, address(0), amount);

        _balances[account] = _balances[account].sub(amount, "ERC20: burn amount exceeds balance");
        _totalSupply = _totalSupply.sub(amount);
        emit Transfer(account, address(0), amount);
    }

    /**
     * @dev Sets `amount` as the allowance of `spender` over the `owner` s tokens.
     *
     * This internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     */
    function _approve(address owner, address spender, uint256 amount) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /**
     * @dev Sets {decimals} to a value other than the default one of 18.
     *
     * WARNING: This function should only be called from the constructor. Most
     * applications that interact with token contracts will not expect
     * {decimals} to ever change, and may work incorrectly if it does.
     */
    function _setupDecimals(uint8 decimals_) internal virtual {
        _decimals = decimals_;
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * will be to transferred to `to`.
     * - when `from` is zero, `amount` tokens will be minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
     * - `from` and `to` are never both zero.
     *
     * To learn more about hooks, head to xref:ROOT:extending-contracts.adoc#using-hooks[Using Hooks].
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual { }
}
contract Wrapped1155Metadata {
    // workaround which also arranges first storage slots of Wrapped1155
    Wrapped1155Factory public factory;
    IERC1155 public multiToken;
    uint256 public tokenId;
    
    modifier onlyFactory() {
        require(msg.sender == address(factory), "Wrapped1155: only factory allowed to perform operation");
        _;
    }
}


contract Wrapped1155 is Wrapped1155Metadata, ERC20 {
    /*//////////////////////////////////////////////////////////////
                            EIP-2612 STORAGE
    //////////////////////////////////////////////////////////////*/

    uint256 internal immutable INITIAL_CHAIN_ID;

    bytes32 internal immutable INITIAL_DOMAIN_SEPARATOR;

    mapping(address => uint256) public nonces;

    constructor() public ERC20("Wrapped ERC-1155 Implementation", "WMT*") {
        INITIAL_CHAIN_ID = _chainId();
        INITIAL_DOMAIN_SEPARATOR = computeDomainSeparator();
    }

    function mint(address account, uint256 amount) external onlyFactory {
        _mint(account, amount);
    }
    
    function burn(address account, uint256 amount) external onlyFactory {
        _burn(account, amount);
    }

    /*//////////////////////////////////////////////////////////////
                             EIP-2612 LOGIC
    //////////////////////////////////////////////////////////////*/

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        require(deadline >= block.timestamp, "PERMIT_DEADLINE_EXPIRED");
        address recoveredAddress = ecrecover(
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR(),
                    keccak256(
                        abi.encode(
                            keccak256(
                                "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                            ),
                            owner,
                            spender,
                            value,
                            nonces[owner]++,
                            deadline
                        )
                    )
                )
            ),
            v,
            r,
            s
        );

        require(recoveredAddress != address(0) && recoveredAddress == owner, "INVALID_SIGNER");
        
        _approve(recoveredAddress, spender, value);


        //emit Approval(owner, spender, value);
    }
    function _chainId() internal pure returns (uint256 chainId) {
        assembly {
            chainId := chainid()
        }
    }
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return computeDomainSeparator();
    }

    function computeDomainSeparator() internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256(bytes(name())),
                    keccak256("1"),
                    _chainId(),
                    address(this)
                )
            );
    }

}


contract Wrapped1155Factory is ERC1155Receiver {
    using Address for address;
    using SafeMath for uint;

    Wrapped1155 public erc20Implementation;

    constructor() public {
        erc20Implementation = new Wrapped1155();
    }

    function onERC1155Received(
        address operator,
        address /* from */,
        uint256 id,
        uint256 value,
        bytes calldata data
    )
        external
        override
        returns (bytes4)
    {
        address recipient = operator;
        // address recipient = data.length > 65 ? 
        //     abi.decode(data[65:], (address)) :
        //     operator;

        Wrapped1155 wrapped1155 = requireWrapped1155(IERC1155(msg.sender), id, data);
        wrapped1155.mint(recipient, value);

        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address operator,
        address /* from */,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    )
        external
        override
        returns (bytes4)
    {
        require(ids.length.mul(65) == data.length, "Wrapped1155Factory: data bytes should be ids size");
        address recipient = operator;
        // address recipient = (data.length > 65) ?
        //     abi.decode(bytes(data[64:]), (address)) :
        //     operator;

        for (uint i = 0; i < ids.length; i++) {
            uint first = i.mul(65);
            uint next = first.add(65);
            requireWrapped1155(IERC1155(msg.sender), ids[i], bytes(data[first:next])).mint(recipient, values[i]);
        }        

        return this.onERC1155BatchReceived.selector;
    }

    function unwrap(
        IERC1155 multiToken,
        uint256 tokenId,
        uint256 amount,
        address recipient,
        bytes calldata data
    )
        external
    {
        getWrapped1155(multiToken, tokenId, data).burn(msg.sender, amount);
        multiToken.safeTransferFrom(address(this), recipient, tokenId, amount, data);
    }

    function batchUnwrap(
        IERC1155 multiToken,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts,
        address recipient,
        bytes calldata data
    )
        external
    {
        require(tokenIds.length == amounts.length, "Wrapped1155Factory: mismatched input arrays");
        require(tokenIds.length.mul(65) == data.length, "Wrapped1155Factory: data bytes should be ids size");
        for (uint i = 0; i < tokenIds.length; i++) {
            uint first = i.mul(65);
            uint next = first.add(65);
            getWrapped1155(multiToken, tokenIds[i], bytes(data[first:next])).burn(msg.sender, amounts[i]);
        }
        multiToken.safeBatchTransferFrom(address(this), recipient, tokenIds, amounts, data);
    }

    function getWrapped1155DeployBytecode(
        IERC1155 multiToken, 
        uint256 tokenId, 
        bytes calldata data
    )
        public
        view
        returns (bytes memory)
    {
        bytes memory tokenName = bytes(data[:32]);
        bytes memory tokenSymbol = bytes(data[32:64]);
        bytes memory tokenDecimal = bytes(data[64:65]);
        return abi.encodePacked(
            // assign factory
            hex"73",
            this,
            hex"3d55",
            
            // assign multiToken
            hex"73",
            multiToken,
            hex"600155",
            
            // assign tokenId
            hex"7f",
            tokenId,
            hex"600255",
            
            // assign name
            hex"7f",
            tokenName,
            hex"600655",
            
            // assign symbol
            hex"7f",
            tokenSymbol,
            hex"600755",
            
            // assign decimals
            hex"60",
            tokenDecimal, 
            hex"600855",

            // push 44 (length of runtime)
            hex"60", uint8(44),
            // load free memory pointer
            hex"604051",

            // dup runtime length
            hex"81",
            // push offset in this calldata to runtime object,
            hex"60", uint8(171),
            // dup free memory pointer
            hex"82"
            
            // codecopy runtime to memory and return
            hex"39f3",

            // greetz 0age for More-Minimal Proxy runtime bytecode
            // @link [Minimal Proxy Contract](https://eips.ethereum.org/EIPS/eip-1167)
            // @link [More-Minimal Proxy](https://medium.com/coinmonks/the-more-minimal-proxy-5756ae08ee48)
            hex"3d3d3d3d363d3d37363d73",
            address(erc20Implementation),
            hex"5af43d3d93803e602a57fd5bf3"
        );
    }
    
    function getWrapped1155(
        IERC1155 multiToken,
        uint256 tokenId,
        bytes calldata data
    )
        public
        view
        returns (Wrapped1155)
    {
        return Wrapped1155(address(uint256(keccak256(abi.encodePacked(
            uint8(0xff),
            this,
            uint256(1155),
            keccak256(getWrapped1155DeployBytecode(multiToken, tokenId, data))
        )))));
    }

    event Wrapped1155Creation(
        IERC1155 indexed multiToken,
        uint256 indexed tokenId,
        Wrapped1155 indexed wrappedToken
    );

    function requireWrapped1155(
        IERC1155 multiToken,
        uint256 tokenId,
        bytes calldata data
    )
        public
        returns (Wrapped1155)
    {
        bytes memory deployBytecode = getWrapped1155DeployBytecode(multiToken, tokenId, data);

        address wrapped1155Address = address(uint256(keccak256(abi.encodePacked(
            uint8(0xff),
            this,
            uint256(1155),
            keccak256(deployBytecode)
        ))));

        if (!wrapped1155Address.isContract()) {
            address addr;
            assembly {
              addr := create2(0, add(deployBytecode, 0x20), mload(deployBytecode), 1155)
            }
            require(wrapped1155Address == addr, "Wrapped1155Factory: failed to deploy");

            emit Wrapped1155Creation(
                multiToken,
                tokenId,
                Wrapped1155(wrapped1155Address)
            );
        }

        return Wrapped1155(wrapped1155Address);
    }
}