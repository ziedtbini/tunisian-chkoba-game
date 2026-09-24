# Plan de test multijoueur CHKOBBA

Utiliser une build identique sur les deux appareils. Sur chaque cas, verifier les transitions visibles, l'absence de double debit de partie disponible et les evenements Analytics `online_*`. Ne jamais rechercher de token ou de cartes dans les logs : ils ne doivent pas y apparaitre.

| # | Scenario | Resultat attendu | Logs / controles |
|---|---|---|---|
| 1 | iPhone Wi-Fi -> iPhone Wi-Fi | Creation, join, partie et scores synchronises | `online_join_success`, un seul debit |
| 2 | iPhone Wi-Fi -> Android Wi-Fi | Idem, noms et tours identiques | mode/role corrects |
| 3 | iPhone Wi-Fi -> Android 4G/5G | Connexion directe ou message clair si NAT strict | timeout sans crash |
| 4 | iPhone 5G -> Android Wi-Fi | Connexion ou limite TURN explicite | aucune boucle agressive |
| 5 | Host en background 10 s | Partie conservee, resync au retour | sync demande |
| 6 | Guest en background 10 s | Reconnexion puis dernier snapshot | reconnect start/success |
| 7 | Wi-Fi coupe puis reactive | Etat reconnecting, reprise < 60 s | aucun double debit |
| 8 | Wi-Fi -> reseau mobile | Reconnexion/backoff et resync | versions monotones |
| 9 | Reseau mobile -> Wi-Fi | Reconnexion/backoff et resync | aucune action rejouee |
| 10 | Verrouiller/deverrouiller | Reprise foreground propre | heartbeat reprend |
| 11 | Mauvais code room | Erreur partie introuvable | join_failed |
| 12 | Troisieme joueur | Refus room full, joueur courant conserve | aucune substitution |
| 13 | Interruption 5 s | Reprise automatique | reconnect_success |
| 14 | Interruption 30 s | Reprise automatique si reseau compatible | backoff borne |
| 15 | Interruption > 60 s | Message de perte definitive, retour menu possible | reconnect_failed |
| 16 | Manche suivante apres reconnexion | Seul host genere la manche, scores conserves | snapshot unique |
| 17 | Rematch apres reconnexion | Seul host regenere, scores remis a zero | snapshot unique |
| 18 | 2v2 online | A controle p1/p3, B controle p2/p4 | aucune main adverse visible |
| 19 | Versions protocole differentes | Partie refusee avec message mise a jour | version mismatch |
| 20 | Sans TURN | Fonctionne sur NAT compatibles, erreur claire sinon | STUN seulement |
| 21 | Avec TURN configure | Connexion sur NAT restrictif | ne jamais logger credentials |

## Verification de confidentialite

1. Inspecter les messages DataChannel en build de developpement.
2. En 1v1 guest, verifier l'absence de `deck` complet et de cartes de la main host.
3. En 2v2 equipe B, verifier l'absence des cartes p1/p3 et du deck.
4. Executer `npm test`; les tests avec identifiants `SECRET_*` prouvent automatiquement cette absence.

## Limite structurelle

Si le host force-quitte l'application, son etat complet en memoire est perdu. Sans backend gratuit ou payant stockant cet etat, la reprise de cette partie est impossible et doit se terminer proprement apres la fenetre de 60 secondes.
