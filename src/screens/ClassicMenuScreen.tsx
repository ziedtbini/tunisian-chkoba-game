import React from "react";
import { BackButton, MenuActionCard, NonGameHero, NonGameScreen, ScoreChoiceModal } from "../components/NonGameUI";
import UiIcon from "../components/UiIcon";

type ScoreTarget = 11 | 21;

type ClassicMenuScreenProps = {
  onBack: () => void;
  onPlaySolo: (targetScore: ScoreTarget) => void;
  onPlayLocal: (targetScore: ScoreTarget) => void;
};

const ClassicMenuScreen: React.FC<ClassicMenuScreenProps> = ({ onBack, onPlaySolo, onPlayLocal }) => {
  const [scorePickerFor, setScorePickerFor] = React.useState<"solo" | "local" | null>(null);

  const chooseScore = (targetScore: ScoreTarget) => {
    if (scorePickerFor === "solo") onPlaySolo(targetScore);
    if (scorePickerFor === "local") onPlayLocal(targetScore);
    setScorePickerFor(null);
  };

  return (
    <NonGameScreen className="menu-selection-screen" contentClassName="non-game-page-pad">
        <BackButton onClick={onBack} />
        <NonGameHero
          icon={<UiIcon name="cards" size={25} />}
          eyebrow="Autour de la table"
          title="Jouer classique"
          subtitle="La Chkoba traditionnelle, en solo ou à deux sur le même appareil."
        />

        <div className="menu-action-stack">
          <MenuActionCard
            title="Contre l'ordinateur"
            subtitle="Affûtez votre jeu face au CPU"
            icon={<span className="mode-mark">CPU</span>}
            onClick={() => setScorePickerFor("solo")}
            tone="classic"
          />

          <MenuActionCard
            title="2 joueurs en local"
            subtitle="Passez le téléphone à votre adversaire"
            icon={<UiIcon name="local" size={25} />}
            onClick={() => setScorePickerFor("local")}
            tone="local"
          />
        </div>
        <p className="non-game-footnote">Règles tunisiennes · 11 ou 21 points</p>

      <ScoreChoiceModal
        open={scorePickerFor !== null}
        description="Choisissez la durée de cette partie classique."
        onClose={() => setScorePickerFor(null)}
        onSelect={chooseScore}
      />
    </NonGameScreen>
  );
};

export default ClassicMenuScreen;
