# Branching za več AI agentov

Namen: več agentov lahko dela vzporedno, brez da vsak takoj spreminja `main`. `main` ostane stabilna veja za GitHub Pages in za uporabo na telefonu.

## Predlagana struktura

```text
main              stabilna produkcija / GitHub Pages
agent/gpt         spremembe tega ChatGPT agenta
agent/codex       spremembe Codex agenta
agent/claude      spremembe Claude agenta
agent/test-*      kratki poskusi, ki se lahko zavržejo
integracija       ročno združevanje dobrih sprememb iz agent vej
```

Trenutno je za ta popravek uporabljena veja `gpt`, ker je uporabnik tako zahteval. Če se projekt razširi, je bolj pregledno preiti na imenovanje `agent/gpt`, `agent/codex`, `agent/claude`.

## Pravilo dela

1. Agent dela samo na svoji veji.
2. Vsaka veja ima kratek vnos v `docs/CHANGELOG.md`.
3. `main` se spreminja samo, ko je sprememba preverjena.
4. Večje ideje se najprej združijo v `integracija`.
5. Na `main` gre samo tisto, kar deluje na telefonu in ne pokvari PWA cache-a.

## Kaj primerjati pred merge

- Ali se aplikacija zažene brez napake.
- Ali `node --check` ne javi sintaktičnih napak v spremenjenih JS datotekah.
- Ali je `APP_CACHE` v `sw.js` dvignjen, če je bil spremenjen app shell.
- Ali se uvoz parcel, karta in Settings odprejo na telefonu.
- Ali je sprememba dokumentirana v changelogu.

## Praktično priporočilo

Za resno delo naj bo tok tak:

```text
agent/gpt -> integracija -> main
agent/codex -> integracija -> main
agent/claude -> integracija -> main
```

Če agent naredi slab poskus, se veja ne briše takoj. Najprej jo pusti kot zgodovino, kasneje jo lahko arhiviraš ali zapreš.
