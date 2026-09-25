import React from "react";
import { BackButton, MenuActionCard, NonGameHero, NonGameScreen } from "../components/NonGameUI";
import UiIcon from "../components/UiIcon";

type OnlineMenuScreenProps = {
  onBack: () => void;
  onPlay1v1: () => void;
  onPlay2v2: () => void;
};

const OnlineMenuScreen: React.FC<OnlineMenuScreenProps> = ({ onBack, onPlay1v1, onPlay2v2 }) => {
  return (
    <NonGameScreen className="menu-selection-screen" contentClassName="non-game-page-pad">
        <BackButton onClick={onBack} />
        <NonGameHero
          icon={<UiIcon name="online" size={25} />}
          eyebrow="Salon connecté"
          title="Jouer en ligne"
          subtitle="Retrouvez vos amis à distance, en duel ou en équipe."
        />

        <div className="menu-action-stack">
          <MenuActionCard
            title="1v1 avec un ami"
            subtitle="Un duel rapide, un salon privé"
            icon={<span className="mode-mark">1×1</span>}
            onClick={onPlay1v1}
            tone="online"
          />

          <MenuActionCard
            title="2v2 avec des amis"
            subtitle="Formez votre équipe et jouez à quatre"
            icon={<UiIcon name="team" size={25} />}
            onClick={onPlay2v2}
            tone="team"
          />

          <MenuActionCard
            title="Trouver un adversaire"
            subtitle="Le matchmaking public arrive bientôt"
            icon={<UiIcon name="search" size={25} />}
            disabled
            badge="Bientôt"
            tone="neutral"
          />
        </div>
        <p className="non-game-footnote">Salons privés · Connexion sécurisée</p>
    </NonGameScreen>
  );
};

export default OnlineMenuScreen;
