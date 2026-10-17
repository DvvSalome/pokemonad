import React, { useEffect, useRef, useState } from 'react';
import { SPECIES_CATALOG, TYPE_COLORS, BALLS as BALL_DEFS, BALL_ORDER } from '../world/species';
import {
  useCapture, startEncounter, showCard, monSpecies, monLevel, monFainted, monLook, type CaughtMon,
} from '../world/captureStore';
import { useBuffs, isShiny, type BuffKey } from '../world/buffs';
import {
  MART, MART_ORDER, buy, claimDaily, useMartNotice, clearNotice, useMartInfo, usePay, loadMart, clearPay, priceLabel, itemName, itemDesc,
  type MartItem, type PayPhase,
} from '../world/martStore';
import { hasWallet } from '../../lib/arc/chain';
import { FAUCET_URL, PAY_DEFAULTS, appChain, txUrl } from '../../lib/arc/payConfig';
import './martPay.css';
import { spawnById, useWild } from '../world/wildStore';
import { useWallet, connect, disconnect, shortAddr } from '../world/walletStore';
import { fmtUsd, modelOf } from '../world/tokenSpecies';
import { cardImage } from './cardCanvas';
import { portrait } from '../world/portrait';
import { useOnline } from '../world/online';
import { LeaguePanel } from './LeaguePanel';
import { AccountPanel } from './AccountPanel';
import { Minimap, RegionMap, useZone, zoneName, ZONE_COLOR } from './Minimap';
import {
  IconDex, IconBox, IconBag, IconMart, IconLeague, IconMenu, IconWallet, IconMissions,
  IconMap, IconTrainers, IconBattle, IconMarket, IconTrade, IconToken, IconAccount, IconLegal, IconAdmin,
} from './hudIcons';
import { MissionsPanel, EggsSection, HatchModal } from './QuestPanels';
import { DexDetail } from './DexDetail';
import { useQuests, eggsReady, setWalking, loadMissions, loadEggs } from '../world/questStore';
import type { RosterEntry } from '../engine/avatar/characterRoster';
import { useRunLock, setRunLock } from '../engine/avatar/useAvatarControls';
import { useBattle } from '../world/battleStore';
import { PresenceBoot } from '../world/PresenceBoot';
import { TokenPanel } from './TokenPanel';
import { AdminPanel } from './AdminPanel';
import { TradePanel, useIncomingTrades } from './TradePanel';
import { LegalPanel } from './LegalPanel';
import { EventBanner } from './EventBanner';
import { BattlePanel } from './BattlePanel';
import { InstallButton } from './InstallButton';
import { MarketPanel } from './MarketPanel';
import { DiscoveredList } from './DiscoveredList';
import './features.css';
import { t, useT, useLang, type Key } from '../i18n';
import { LangSwitch } from './LangSwitch';
import './polish/core.css';

interface Props {
  character: RosterEntry;
}

type Panel = null | 'dex' | 'bag' | 'box' | 'menu' | 'mart' | 'league' | 'map' | 'missions' | 'account' | 'token' | 'trade' | 'admin' | 'legal' | 'battle' | 'market';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Miniatura de carta en la Caja: dibuja la carta (con retrato 3D) y la muestra; al tocarla, la revela. */
const BoxCard: React.FC<{ mon: CaughtMon; i: number }> = ({ mon, i }) => {
  const [img, setImg] = useState<string | null>(null);
  const level = monLevel(mon);
  const fainted = monFainted(mon);
  const mcap = mon.token?.marketCap;
  const lang = useLang();
  useEffect(() => {
    let alive = true;
    const species = monSpecies(mon);
    if (!species) return;
    (async () => {
      const pic = await portrait(mon.model, monLook(mon)).catch(() => '');
      const dexNo = SPECIES_CATALOG.findIndex((s) => s.id === mon.speciesId) + 1;
      const url = await cardImage({ species, dexNo, level, portrait: pic || undefined, total: SPECIES_CATALOG.length, token: mon.token, fainted, shiny: mon.shiny });
      if (alive) setImg(url);
    })();
    return () => { alive = false; };
    // mcap/level/fainted: la carta se redibuja cuando el token cambia de valor.
  }, [mon.id, mon.model, level, fainted, mcap, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button className={`pg-box-card ${img ? '' : 'skel'} ${fainted ? 'fainted' : ''} ${mon.shiny ? 'shiny' : ''}`} style={{ ['--i' as string]: Math.min(i, 16) }} onClick={() => showCard(mon.id)} title={`${mon.shiny ? '✨ ' : ''}${mon.name} · Lv ${level}${mon.token ? ` · $${mon.token.symbol}` : ''}${mon.token?.dexNo ? ` · Dex #${mon.token.dexNo}` : ''}${mon.discovered ? ` · ${t('hud.discoveredByYou')}` : ''}`}>
      {img && <img src={img} alt={mon.name} />}
    </button>
  );
};

const FEED_LABEL: Record<string, Key> = { arc: 'feed.arc', loading: 'feed.loading', demo: 'feed.demo', error: 'feed.error' };

type MenuItem = { label: Key; Ic: React.FC<{ size?: number }>; panel?: Panel };
const MENU_ITEMS: MenuItem[] = [
  { label: 'nav.dex', Ic: IconDex, panel: 'dex' }, { label: 'nav.box', Ic: IconBox, panel: 'box' }, { label: 'nav.bag', Ic: IconBag, panel: 'bag' },
  { label: 'nav.map', Ic: IconMap, panel: 'map' }, { label: 'nav.league', Ic: IconLeague, panel: 'league' }, { label: 'nav.trainers', Ic: IconTrainers, panel: 'league' },
  { label: 'nav.missions', Ic: IconMissions, panel: 'missions' },
  { label: 'nav.battle', Ic: IconBattle, panel: 'battle' }, { label: 'nav.market', Ic: IconMarket, panel: 'market' },
  { label: 'nav.mart', Ic: IconMart, panel: 'mart' }, { label: 'nav.trade', Ic: IconTrade, panel: 'trade' }, { label: 'nav.token', Ic: IconToken, panel: 'token' },
  { label: 'nav.account', Ic: IconAccount, panel: 'account' }, { label: 'nav.legal', Ic: IconLegal, panel: 'legal' },
];

/**
 * HUD sobre el mundo: tarjeta de entrenador con la wallet arriba a la izquierda, dock de botones de
 * consola arriba a la derecha, banner al cambiar de zona y minimapa real abajo (que abre el mapa grande).
 */
export const HUD: React.FC<Props> = ({ character }) => {
  const [panel, setPanelNow] = useState<Panel>(null);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<Panel>(null);
  const closeTimer = useRef(0);
  const [dexTab, setDexTab] = useState<'species' | 'tokens'>('species');
  const [dexFocus, setDexFocus] = useState<string | null>(null);
  useT();
  // Cerrar deja la ventana montada ~170 ms para que se vea su animación de salida.
  const setPanel = (p: Panel) => {
    window.clearTimeout(closeTimer.current);
    if (p === null && panelRef.current !== null) {
      setClosing(true);
      closeTimer.current = window.setTimeout(() => { panelRef.current = null; setPanelNow(null); setClosing(false); }, 170);
      return;
    }
    panelRef.current = p;
    setClosing(false);
    setPanelNow(p);
  };
  const toggle = (p: Panel) => setPanel(panelRef.current === p ? null : p);
  const cap = useCapture();
  const wild = useWild();
  const wallet = useWallet();
  const online = useOnline();
  const caughtCount = cap.caughtSpecies.size;
  const boxCount = cap.collection.length;
  const ballTotal = BALL_ORDER.reduce((n, k) => n + cap.balls[k], 0);
  // Nombre del monstruo cercano, para el prompt "pulsa E".
  const nearSpawn = spawnById(cap.nearbyId);
  const showPrompt = !cap.activeId && nearSpawn;
  const buffs = useBuffs();
  const notice = useMartNotice();
  const now = useClock();
  const zone = useZone();
  const running = useRunLock();
  const quests = useQuests();
  const battle = useBattle();
  const missionsDue = quests.missions ? [...quests.missions.d, ...quests.missions.w].filter((x) => x.p >= x.goal && !x.claimed).length : 0;
  const hatchDue = eggsReady(quests.eggs);
  const tradesDue = useIncomingTrades(online.status === 'online', panel === 'trade');
  const tier = online.trainer?.holder?.tier ?? null;
  const menuItems = online.trainer?.admin ? [...MENU_ITEMS, { label: 'nav.admin', Ic: IconAdmin, panel: 'admin' } as MenuItem] : MENU_ITEMS;
  useEffect(() => { setWalking(true); return () => setWalking(false); }, []);
  useEffect(() => {
    if (online.status !== 'online') return;
    void loadMissions(); void loadEggs();
    const t = setInterval(() => { void loadMissions(); }, 60_000);
    return () => clearInterval(t);
  }, [online.status]);
  const [avatar, setAvatar] = useState('');
  useEffect(() => { portrait(character.modelo_url, { bust: true }).then(setAvatar); }, [character.modelo_url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'm' || e.key === 'M') toggle('map');
      else if (e.key === 'Escape' && panelRef.current) setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Regalo diario: al entrar, y otra vez al conectar la wallet (su parte extra).
  useEffect(() => { claimDaily(!!wallet.address); }, [wallet.address]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 4200);
    return () => clearTimeout(t);
  }, [notice]);
  const activeBuffs = (Object.keys(BUFF_LABEL) as BuffKey[]).filter((k) => buffs[k] > now);
  const privateLeft = wild.spawns.filter((sp) => sp.kind === 'lure' || sp.kind === 'safari');
  const privateUntil = privateLeft.reduce((m, sp) => Math.max(m, sp.expiresAt ?? 0), 0);

  // En el estadio la pantalla es del combate: nada de HUD encima.
  if (battle.active && battle.view === 'arena') return null;

  return (
    <>
      <PresenceBoot character={character} />
      <div className="pg-top">
        <div className="pg-profile">
          <div className="av">{avatar ? <img src={avatar} alt="" /> : <span>{character.emoji}</span>}</div>
          <div className="info">
            <b className="nm">
              {online.trainer?.name ?? character.nombre}
              {tier && <button className={`pg-tierchip t-${tier}`} onClick={() => toggle('token')} title={t('hud.tierTitle')}>{tier}</button>}
            </b>
            <span className="pts">
              <em>{online.trainer?.weekPoints ?? 0}</em> {t('hud.ptsWeek')}
              <i className={`st st-${online.status === 'online' ? 'on' : 'off'}`} title={t(online.status === 'online' ? 'hud.synced' : 'hud.offline')} />
            </span>
            {wallet.address ? (
              <button className="pg-wchip on" onClick={disconnect} title={t('hud.walletDisconnect', { addr: wallet.address })}>
                <IconWallet size={16} /> {shortAddr(wallet.address)}{wallet.usdc !== null && <b>{wallet.usdc} MON</b>}
              </button>
            ) : (
              <button className="pg-wchip" onClick={() => void connect()} disabled={wallet.status === 'connecting'} title={wallet.error ?? t('hud.connectMonad')}>
                <IconWallet size={16} /> {t(wallet.status === 'connecting' ? 'common.connecting' : 'common.connectWallet')}
              </button>
            )}
          </div>
        </div>
        {/* Solo avisos que piden acción (misión cobrable, huevo listo): los contadores viven dentro de cada ventana. */}
        <nav className="pg-dock">
          <DockBtn label={t('nav.dex')} on={panel === 'dex'} onClick={() => toggle('dex')}><IconDex /></DockBtn>
          <DockBtn label={t('nav.box')} on={panel === 'box'} dot={hatchDue} onClick={() => toggle('box')}><IconBox /></DockBtn>
          <DockBtn label={t('nav.bag')} on={panel === 'bag'} onClick={() => toggle('bag')}><IconBag /></DockBtn>
          <DockBtn label={t('nav.missions')} on={panel === 'missions'} badge={missionsDue || undefined} onClick={() => toggle('missions')}><IconMissions /></DockBtn>
          <DockBtn label={t('nav.mart')} on={panel === 'mart'} onClick={() => toggle('mart')}><IconMart /></DockBtn>
          <DockBtn label={t('nav.league')} on={panel === 'league'} onClick={() => toggle('league')}><IconLeague /></DockBtn>
          <DockBtn label={t('nav.menu')} on={panel === 'menu'} dark badge={tradesDue || undefined} onClick={() => toggle('menu')}><IconMenu /></DockBtn>
        </nav>
      </div>

      <ZoneBanner zone={zone} />
      <KeyHint running={running} />
      {running && <button className="pg-runtag" onClick={() => setRunLock(false)} title={t('hud.alwaysRunTitle')}>👟 {t('hud.alwaysRun')}</button>}
      {(activeBuffs.length > 0 || privateLeft.length > 0) && (
        <div className="pg-buffs">
          {activeBuffs.map((k) => <span className="pg-buff" key={k}>{t(BUFF_LABEL[k])} <b>{mmss(buffs[k] - now)}</b></span>)}
          {privateLeft.length > 0 && <span className="pg-buff">🍯 {t('hud.nearby', { n: privateLeft.length })} <b>{mmss(privateUntil - now)}</b></span>}
        </div>
      )}
      {wallet.error && !wallet.address && <div className="pg-toast pg-glass" onClick={disconnect}>{wallet.error}</div>}
      {notice && !wallet.error && <div className="pg-toast pg-glass ok" onClick={clearNotice}>{notice.text}</div>}

      <Minimap zone={zone} onOpen={() => setPanel('map')} />
      <span className={`pg-feed3 f-${wild.source}`} title={t(FEED_LABEL[wild.source])}><i />{wild.source === 'arc' ? t('feed.wild', { n: wild.spawns.length - privateLeft.length }) : t(FEED_LABEL[wild.source])}</span>
      <div className={`pg-winhost${closing ? ' closing' : ''}`}>
      {panel === 'map' && <RegionMap zone={zone} onClose={() => setPanel(null)} />}

      {showPrompt && (
        <button className="pg-prompt pg-glass" onClick={() => startEncounter(nearSpawn!.id)}>
          <kbd>E</kbd> {t('hud.encounter')} <b>{isShiny(nearSpawn!.id) ? '✨ ' : ''}{nearSpawn!.species.name}</b>
          {nearSpawn!.token && <span className="pg-prompt-tok">${nearSpawn!.token.symbol} · {fmtUsd(nearSpawn!.token.marketCap)}</span>}
        </button>
      )}

      {panel === 'dex' && (
        <div className="pg-drawer pg-win k-dex">
          <h3>{t('nav.dex')} <span className="pg-count">{caughtCount}/{SPECIES_CATALOG.length}</span> <button className="x" onClick={() => setPanel(null)}>✕</button></h3>
          <div className="pg-f-tabs">
            <button className={dexTab === 'species' ? 'on' : ''} onClick={() => setDexTab('species')}>{t('dx.tab.species')}</button>
            <button className={dexTab === 'tokens' ? 'on' : ''} onClick={() => setDexTab('tokens')}>{t('dx.tab.tokens')}</button>
          </div>
          {dexTab === 'tokens' ? <DiscoveredList /> : (
            <>
              <div className="pg-dex-legend">
                <span className="c">{t('dex.legendCaught', { n: caughtCount })}</span>
                <span className="u">{t('dex.legendMissing', { n: SPECIES_CATALOG.length - caughtCount })}</span>
              </div>
              <div className="pg-progress"><i style={{ width: `${(caughtCount / SPECIES_CATALOG.length) * 100}%` }} /></div>
              <div className="pg-dex-grid">
                {SPECIES_CATALOG.map((s, i) => (
                  <DexTile key={s.id} no={i + 1} id={s.id} seen={cap.caughtSpecies.has(s.id)} onOpen={() => setDexFocus(s.id)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {dexFocus && (
        <DexDetail
          speciesId={dexFocus}
          seen={cap.caughtSpecies.has(dexFocus)}
          onClose={() => setDexFocus(null)}
          onFly={() => setPanel(null)}
        />
      )}

      {panel === 'bag' && (
        <div className="pg-drawer pg-win k-bag">
          <h3>{t('nav.bag')} <span className="pg-count">{t('bag.balls', { n: ballTotal })}</span> <button className="x" onClick={() => setPanel(null)}>✕</button></h3>
          <div className="pg-bag-grid">
            {BALL_ORDER.map((k, i) => {
              const count = cap.balls[k];
              const m = BALL_DEFS[k].mult;
              return (
                <div className={`pg-bag-tile${count ? '' : ' empty'}`} key={k} style={{ ['--i' as string]: i, ['--bc' as string]: hex(BALL_DEFS[k].color) }}>
                  <span className="pg-ball-ic big" style={ballStyle(hex(BALL_DEFS[k].color), 64)} />
                  <b>{BALL_DEFS[k].name}</b>
                  <span className="mult">{m === Infinity ? t('bag.sure') : t('bag.power', { m })}</span>
                  <span className="n">×{count}</span>
                </div>
              );
            })}
          </div>
          {activeBuffs.length > 0 && (
            <>
              <h4 className="pg-sub">{t('bag.active')}</h4>
              <div className="pg-bag-buffs">{activeBuffs.map((k) => <span className="pg-buff" key={k}>{t(BUFF_LABEL[k])} <b>{mmss(buffs[k] - now)}</b></span>)}</div>
            </>
          )}
          <p className="pg-empty">{t('bag.outPre')} <button className="pg-link" onClick={() => setPanel('mart')}>{t('nav.mart')}</button> {t('bag.outPost')}</p>
        </div>
      )}

      {panel === 'box' && (
        <div className="pg-drawer pg-win k-box">
          <h3>{t('nav.box')} <span className="pg-count">{t('box.cards', { n: boxCount })}</span> <button className="x" onClick={() => setPanel(null)}>✕</button></h3>
          <EggsSection />
          <h4 className="pg-sub">{t('box.cardsH')}</h4>
          {boxCount === 0 ? (
            <p className="pg-empty">{t('box.empty')}</p>
          ) : (
            <div className="pg-box-grid">
              {[...cap.collection].reverse().map((m, i) => <BoxCard key={m.id} mon={m} i={i} />)}
            </div>
          )}
        </div>
      )}

      {panel === 'mart' && <MartPanel onClose={() => setPanel(null)} buffs={buffs} now={now} online={online.status === 'online'} />}

      {panel === 'league' && <LeaguePanel onClose={() => setPanel(null)} />}
      {panel === 'missions' && <MissionsPanel onClose={() => setPanel(null)} />}
      {panel === 'account' && <AccountPanel onClose={() => setPanel(null)} />}
      {panel === 'token' && <TokenPanel onClose={() => setPanel(null)} />}
      {panel === 'trade' && <TradePanel onClose={() => setPanel(null)} />}
      {panel === 'admin' && <AdminPanel onClose={() => setPanel(null)} />}
      {panel === 'legal' && <LegalPanel onClose={() => setPanel(null)} />}
      {panel === 'battle' && <BattlePanel onClose={() => setPanel(null)} />}
      {panel === 'market' && <MarketPanel onClose={() => setPanel(null)} />}
      <EventBanner onOpenMap={() => setPanel('map')} />
      <HatchModal />

      {panel === 'menu' && (
        <div className="pg-overlay pg-menu-overlay" onClick={() => setPanel(null)}>
          <div className="pg-sheet pg-menu-sheet" onClick={(e) => e.stopPropagation()} onKeyDown={menuKeys}>
            <header className="pg-menu-head">
              <small>{t('menu.eyebrow')}</small>
              <h2>{t('nav.menu')}</h2>
              <button className="x" onClick={() => setPanel(null)} aria-label={t('common.close')}>✕</button>
            </header>
            <div className="pg-menu-grid">
              {menuItems.map((m, i) => (
                <button
                  className="pg-menu-item"
                  key={m.label}
                  style={{ ['--i' as string]: i }}
                  onClick={() => setPanel(m.panel ?? null)}
                  disabled={!m.panel}
                  title={m.panel ? '' : t('menu.soonTitle')}
                  autoFocus={i === 0}
                >
                  <span className="em"><m.Ic size={34} /></span>
                  <span className="lb">{t(m.label)}</span>
                  {m.panel === 'trade' && tradesDue > 0 && <span className="pg-soon">{t('menu.new', { n: tradesDue })}</span>}
                  {!m.panel && <span className="pg-soon">{t('menu.soon')}</span>}
                </button>
              ))}
              <InstallButton />
            </div>
            <div className="pg-menu-foot">
              <LangSwitch tone="light" />
              <p className="pg-legal-links">
                <button className="pg-link" onClick={() => setPanel('legal')}>{t('menu.legalLinks')}</button>
                <span>{t('menu.legalNote')}</span>
              </p>
              <div className="pg-menu-keys">
                <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> {t('menu.keyMove')}</span>
                <span><kbd>Enter</kbd> {t('menu.keyOpen')}</span>
                <span><kbd>Esc</kbd> {t('common.close')}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

/** Flechas dentro del menú: se mueven por la rejilla según las columnas que haya en ese ancho. */
function menuKeys(e: React.KeyboardEvent<HTMLDivElement>) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 0, ArrowDown: 0 }[e.key];
  if (step === undefined) return;
  const grid = e.currentTarget.querySelector<HTMLElement>('.pg-menu-grid');
  if (!grid) return;
  const items = [...grid.querySelectorAll<HTMLButtonElement>('.pg-menu-item:not(:disabled)')];
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
  const cur = items.indexOf(document.activeElement as HTMLButtonElement);
  const d = e.key === 'ArrowUp' ? -cols : e.key === 'ArrowDown' ? cols : step;
  const next = cur < 0 ? 0 : Math.min(items.length - 1, Math.max(0, cur + d));
  items[next]?.focus();
  e.preventDefault();
  e.stopPropagation();
}

/** Casilla del Dex: retrato 3D de la primera etapa; silueta negra si aún no la has atrapado. */
const DexTile: React.FC<{ no: number; id: string; seen: boolean; onOpen: () => void }> = ({ no, id, seen, onOpen }) => {
  const [img, setImg] = useState('');
  const sp = SPECIES_CATALOG[no - 1];
  useEffect(() => {
    let alive = true;
    portrait(modelOf(id, 1)).then((u) => alive && setImg(u));
    return () => { alive = false; };
  }, [id]);
  return (
    <button type="button" className={`pg-dex-tile ${seen ? 'seen' : 'unseen'} t-${sp.tier}`} style={{ ['--tc' as string]: TYPE_COLORS[sp.type], ['--i' as string]: Math.min(no - 1, 24) }} onClick={onOpen}>
      {seen && <span className="ok" aria-hidden />}
      <span className="no">#{String(no).padStart(3, '0')}</span>
      <div className="pic">{img ? <img src={img} alt="" /> : <i className="spin" />}</div>
      <b>{seen ? sp.name : '???'}</b>
      <span className="meta"><span className="pg-chip" style={{ ['--c' as string]: TYPE_COLORS[sp.type] }}>{sp.type}</span><span className={`pg-rar t-${sp.tier}`}>{sp.tier}</span></span>
    </button>
  );
};

const DockBtn: React.FC<{ label: string; on?: boolean; badge?: number; dot?: boolean; gold?: boolean; dark?: boolean; onClick: () => void; children: React.ReactNode }> = ({ label, on, badge, dot, gold, dark, onClick, children }) => (
  <button className={`pg-dbtn${on ? ' on' : ''}${gold ? ' gold' : ''}${dark ? ' dark' : ''}${dot ? ' dot' : ''}`} onClick={onClick} aria-label={label} data-label={label}>
    <span className="ic">{children}</span>
    {badge !== undefined && badge > 0 && <span className="bd">{badge > 99 ? '99+' : badge}</span>}
  </button>
);

/** Recordatorio de teclas al entrar: se ve unos segundos y se va, en vez de ocupar pantalla siempre. */
const KeyHint: React.FC<{ running: boolean }> = ({ running }) => {
  useT();
  const [show, setShow] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShow(false), 11000); return () => clearTimeout(t); }, []);
  if (!show) return null;
  return (
    <div className="pg-keyhint">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {t('keys.move')}</span>
      <span><kbd>Shift</kbd> {t(running ? 'keys.walk' : 'keys.run')}</span>
      <span><kbd>R</kbd> {t('keys.alwaysRun')}</span>
      <span><kbd>M</kbd> {t('keys.map')}</span>
    </div>
  );
};

/** Cartel "entrando a…" que aparece unos segundos al cambiar de zona, como en los juegos de la saga. */
const ZoneBanner: React.FC<{ zone: string }> = ({ zone }) => {
  useT();
  const [shown, setShown] = useState<string | null>(zone);
  useEffect(() => {
    setShown(zone);
    const t = setTimeout(() => setShown(null), 3600);
    return () => clearTimeout(t);
  }, [zone]);
  if (!shown) return null;
  return (
    <div className="pg-zone" key={shown} style={{ ['--zc' as string]: ZONE_COLOR[shown] }}>
      <small>{t('zone.nowEntering')}</small>
      <b><i />{zoneName(shown)}<i /></b>
    </div>
  );
};

const BUFF_LABEL: Record<BuffKey, Key> = { radar: 'buff.radar', charm: 'buff.charm', revive: 'buff.revive' };

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** Hora actual que se refresca cada segundo (cuentas atrás de los objetos). */
function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}

const PAY_STEP: Record<Exclude<PayPhase, 'idle'>, Key> = {
  connecting: 'pay.connecting',
  signing: 'pay.signing',
  confirming: 'pay.confirming',
  done: 'pay.done',
  error: 'pay.error',
};

const MartPanel: React.FC<{ onClose: () => void; buffs: Record<BuffKey, number>; now: number; online: boolean }> = ({ onClose, buffs, now, online }) => {
  useT();
  const info = useMartInfo();
  const pay = usePay();
  const busy = pay.phase === 'connecting' || pay.phase === 'signing' || pay.phase === 'confirming';
  useEffect(() => { if (online) void loadMart(); }, [online]);
  useEffect(() => () => clearPay(), []);
  const symbol = info?.symbol ?? PAY_DEFAULTS.symbol;
  const chain = info?.chainName ?? appChain.name;
  const blocked = !online ? t('mart.blockedOffline')
    : !hasWallet() ? t('mart.blockedWallet', { symbol })
    : info && !info.ready ? t('mart.blockedClosed') : null;
  return (
    <div className="pg-drawer pg-win pg-mart k-mart">
      <h3>{t('mart.title')} <button className="x" onClick={onClose}>✕</button></h3>
      <p className="pg-mart-note">
        {t('mart.note', { symbol, chain })}
        {FAUCET_URL && <> {t('mart.faucetPre', { symbol })} <a className="pg-link" href={FAUCET_URL} target="_blank" rel="noreferrer">faucet.circle.com</a>.</>}
      </p>
      {blocked && <p className="pg-pay-block">{blocked}</p>}
      {pay.phase !== 'idle' && pay.item && (
        <div className={`pg-pay-status ph-${pay.phase}`}>
          {busy && <i className="pg-pay-spin" />}
          <div className="txt">
            <b>{itemName(pay.item)} · {t(PAY_STEP[pay.phase])}</b>
            {pay.msg && <span>{pay.msg}</span>}
            {pay.faucet && FAUCET_URL && <a className="pg-link" href={FAUCET_URL} target="_blank" rel="noreferrer">{t('mart.faucetLink', { symbol })}</a>}
            {pay.hash && <a className="pg-link" href={txUrl(pay.hash)} target="_blank" rel="noreferrer">{t('mart.viewTx')}</a>}
          </div>
          {!busy && <button className="x" onClick={clearPay} title={t('common.close')}>✕</button>}
        </div>
      )}
      <div className="pg-mart-grid">
        {MART_ORDER.map((k, i) => {
          const it = MART[k];
          const left = it.buff ? buffs[it.buff] - now : 0;
          const mine = busy && pay.item === k;
          const price = info?.prices[k];
          const ball = BALL_DEFS[it.icon as keyof typeof BALL_DEFS];
          return (
            <div className={`pg-mart-item ${it.soon ? 'soon' : ''} ${left > 0 ? 'active' : ''} ${mine ? 'buying' : ''}`} key={k} style={{ ['--i' as string]: i, ['--bc' as string]: ball ? hex(ball.color) : '#4c9bff' }}>
              <ItemIcon it={it} />
              <b>{itemName(k)}</b>
              <p>{itemDesc(k)}</p>
              <div className="pg-mart-foot">
                <span className="usd">{it.soon ? '' : priceLabel(info, k)}</span>
                {left > 0 && <span className="pg-mart-on">{t('mart.on', { t: mmss(left) })}</span>}
                <button className="pg-btn small" disabled={it.soon || busy || !!blocked || !price} onClick={() => void buy(k)}>
                  {it.soon ? t('common.soon') : mine ? '…' : t('mart.payWith', { symbol })}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ItemIcon: React.FC<{ it: MartItem }> = ({ it }) => {
  const ball = it.icon as keyof typeof BALL_DEFS;
  if (BALL_DEFS[ball]) return <span className="pg-mart-ic"><span className="pg-ball-ic" style={ballStyle(hex(BALL_DEFS[ball].color))} /></span>;
  return <span className="pg-mart-ic">{it.icon}</span>;
};

/** Icono de bola en CSS, del color del tipo. */
function ballStyle(color: string, size = 22): React.CSSProperties {
  return {
    width: size, height: size, borderRadius: '50%', flex: 'none',
    background: `linear-gradient(180deg, ${color} 0 47%, #1a2330 47% 53%, #f4f6fb 53%)`,
    boxShadow: 'inset 0 -2px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.25)',
  };
}
