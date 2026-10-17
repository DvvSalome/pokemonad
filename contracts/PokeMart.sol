// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PokeMart
 * @notice La tienda del juego cobrando en MON nativo de Monad.
 *
 * Cada objeto del Poké Mart tiene un id (0..7, el mismo orden que la estantería de la UI) y un precio en wei.
 * `buy(item, count)` exige el importe exacto, lo reenvía en el acto a la tesorería —el contrato nunca guarda
 * fondos, así que no hay nada que robarle— y emite `Purchased`. Ese evento es el recibo: el servidor del
 * juego (Edge Function `game`, acción `mon-buy`) lo lee del recibo de la transacción para entregar las bolas,
 * y cualquier indexador puede reconstruir el historial de compras de una wallet sin leer estado.
 *
 * Ids: 0 Grass ×1 · 1 Grass ×10 · 2 Super ×1 · 3 Super ×5 · 4 Hyper ×1 · 5 Hyper ×3 · 6 Hood · 7 Radar.
 *
 * Despliegue (Monad testnet, chainId 10143), con la tesorería como argumento:
 *   forge create contracts/PokeMart.sol:PokeMart --constructor-args <TESORERIA> \
 *     --keystore ~/.monskills/keystore/<id> --password "" --broadcast
 * La dirección va a VITE_MART_CONTRACT (cliente) y a MON_MART_CONTRACT (secret de la función).
 */
contract PokeMart {
    uint8 public constant ITEM_COUNT = 8;
    /// @notice Tope de unidades por compra, para que un error de la UI no vacíe una wallet.
    uint8 public constant MAX_COUNT = 20;

    address public owner;
    address payable public treasury;
    bool public paused;
    /// @notice Precio de cada objeto en wei de MON. 0 = no está a la venta.
    uint256[ITEM_COUNT] public price;

    /// @notice Total gastado por wallet y número de pedidos, para el perfil y la liga.
    mapping(address => uint256) public spentBy;
    mapping(address => uint32) public ordersBy;
    uint256 public orders;

    event Purchased(address indexed buyer, uint8 indexed item, uint8 count, uint256 paid, uint256 indexed orderId);
    event PriceSet(uint8 indexed item, uint256 price);
    event TreasurySet(address treasury);
    event Paused(bool paused);

    error NotOwner();
    error IsPaused();
    error UnknownItem(uint8 item);
    error BadCount(uint8 count);
    error WrongValue(uint256 expected, uint256 sent);
    error PayoutFailed();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address payable treasury_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        treasury = treasury_;
        // Precios de testnet: céntimos de MON. Se cambian con setPrice sin redesplegar.
        price[0] = 0.002 ether;
        price[1] = 0.015 ether;
        price[2] = 0.005 ether;
        price[3] = 0.02 ether;
        price[4] = 0.01 ether;
        price[5] = 0.025 ether;
        price[6] = 0.04 ether;
        price[7] = 0.012 ether;
    }

    /// @notice Compra `count` unidades del objeto `item` pagando exactamente price[item] * count.
    function buy(uint8 item, uint8 count) external payable returns (uint256 orderId) {
        if (paused) revert IsPaused();
        if (item >= ITEM_COUNT || price[item] == 0) revert UnknownItem(item);
        if (count == 0 || count > MAX_COUNT) revert BadCount(count);
        uint256 cost = price[item] * count;
        if (msg.value != cost) revert WrongValue(cost, msg.value);

        orderId = ++orders;
        spentBy[msg.sender] += cost;
        ordersBy[msg.sender] += 1;
        emit Purchased(msg.sender, item, count, cost, orderId);

        (bool ok,) = treasury.call{value: cost}("");
        if (!ok) revert PayoutFailed();
    }

    /// @notice Todos los precios de una vez, para pintar la tienda con una sola llamada.
    function prices() external view returns (uint256[ITEM_COUNT] memory) {
        return price;
    }

    function setPrice(uint8 item, uint256 newPrice) external onlyOwner {
        if (item >= ITEM_COUNT) revert UnknownItem(item);
        price[item] = newPrice;
        emit PriceSet(item, newPrice);
    }

    function setTreasury(address payable next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        treasury = next;
        emit TreasurySet(next);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        owner = next;
    }
}
