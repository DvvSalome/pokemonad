// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AcademyGatekeeper
 * @notice Portero y libro de notas del Coliseo Monad — el módulo educativo del juego.
 *
 * Tres cosas, y nada más que esas tres:
 *
 *  1. `enter()`  — el jugador se matricula. Es la transacción que abre la puerta del coliseo: no cuesta
 *     nada más que el gas (sub-céntimo en Monad) y deja constancia on-chain de que esa wallet entró.
 *     Al ser gas tan barato, sirve de verificación F2P sin pedir un peaje al usuario.
 *
 *  2. `completeBoss()` — al derrotar a un jefe se registra la nota y se acuña una insignia SOULBOUND:
 *     intransferible por diseño, porque certifica que *esa* persona respondió bien, y un certificado que
 *     se puede vender no certifica nada. No es un ERC-721: no hay `transferFrom` que anular, directamente
 *     no existe. El estándar que sí se respeta es el de los eventos, para que un indexador (Envio) pueda
 *     reconstruir el progreso de cualquier wallet sin leer el estado.
 *
 *  3. Lectura — `profileOf()` devuelve en una sola llamada lo que la UI necesita para pintar el panel.
 *
 * Despliegue (Monad testnet, chainId 10143):
 *   forge create contracts/AcademyGatekeeper.sol:AcademyGatekeeper \
 *     --rpc-url https://testnet-rpc.monad.xyz --private-key $PK --broadcast
 * y la dirección resultante va a VITE_ACADEMY_CONTRACT. Sin esa variable el juego funciona igual, en
 * modo demostración: la puerta se abre firmando un mensaje en vez de mandando una transacción.
 */
contract AcademyGatekeeper {
    /// @notice Los tres jefes/módulos. El orden es el del temario, de menos a más.
    uint8 public constant BOSS_COUNT = 3;

    struct Profile {
        /// Momento de la matrícula. 0 = esta wallet nunca ha entrado.
        uint64 enrolledAt;
        /// Bitmap de jefes derrotados: bit i = jefe i.
        uint8 badges;
        /// Intentos totales, para que la UI pueda enseñar "a la tercera va la vencida".
        uint32 attempts;
        /// Mejor puntuación por jefe (aciertos sobre el total de la pelea), 0..100.
        uint8[BOSS_COUNT] bestScore;
    }

    mapping(address => Profile) private _profiles;
    /// @notice Cuántas insignias se han emitido de cada jefe. Útil para la tabla de la liga.
    uint32[BOSS_COUNT] public minted;

    event Enrolled(address indexed student, uint64 at);
    event AttemptStarted(address indexed student, uint8 indexed boss, uint64 at);
    event BadgeMinted(address indexed student, uint8 indexed boss, uint8 score, uint64 at);

    error NotEnrolled();
    error UnknownBoss(uint8 boss);
    error BadScore(uint8 score);

    /// @notice Matrícula: abre la puerta del coliseo para esta wallet. Idempotente.
    function enter() external {
        Profile storage p = _profiles[msg.sender];
        if (p.enrolledAt == 0) {
            p.enrolledAt = uint64(block.timestamp);
            emit Enrolled(msg.sender, p.enrolledAt);
        }
    }

    /// @notice Se llama al empezar una pelea. Sirve para medir cuánto cuesta aprender cada tema.
    function startAttempt(uint8 boss) external {
        Profile storage p = _profiles[msg.sender];
        if (p.enrolledAt == 0) revert NotEnrolled();
        if (boss >= BOSS_COUNT) revert UnknownBoss(boss);
        unchecked { p.attempts += 1; }
        emit AttemptStarted(msg.sender, boss, uint64(block.timestamp));
    }

    /**
     * @notice Victoria: registra la nota y acuña la insignia si es la primera vez.
     * @param boss  Índice del jefe derrotado.
     * @param score Aciertos sobre el total, 0..100.
     */
    function completeBoss(uint8 boss, uint8 score) external {
        Profile storage p = _profiles[msg.sender];
        if (p.enrolledAt == 0) revert NotEnrolled();
        if (boss >= BOSS_COUNT) revert UnknownBoss(boss);
        if (score > 100) revert BadScore(score);

        if (score > p.bestScore[boss]) p.bestScore[boss] = score;

        uint8 bit = uint8(1 << boss);
        // Los paréntesis importan: == ata más fuerte que &, y sin ellos la insignia no se acuñaba nunca.
        if ((p.badges & bit) == 0) {
            p.badges |= bit;
            unchecked { minted[boss] += 1; }
        }
        emit BadgeMinted(msg.sender, boss, score, uint64(block.timestamp));
    }

    /// @notice Todo lo que la UI necesita de una wallet, en una sola llamada.
    function profileOf(address student)
        external
        view
        returns (uint64 enrolledAt, uint8 badges, uint32 attempts, uint8[BOSS_COUNT] memory bestScore)
    {
        Profile storage p = _profiles[student];
        return (p.enrolledAt, p.badges, p.attempts, p.bestScore);
    }

    /// @notice ¿Tiene esta wallet la insignia de ese jefe?
    function hasBadge(address student, uint8 boss) external view returns (bool) {
        if (boss >= BOSS_COUNT) revert UnknownBoss(boss);
        return (_profiles[student].badges & uint8(1 << boss)) != 0;
    }
}
