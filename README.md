# Navitia disruptions notification pusher (APNS)
Ce serveur permet de pousser des notifications de perturbations vers des devices iOS par le service APN (Apple Push Notifications), en pollant une API Navitia.

## Installation
### Prérequis
- Node.js
- une clé d'API PRIM IDFM
- un certificat APN
- le fichier de configuration (voir plus bas)

### Installation
- `yarn install`
- `cp config.example.json config.json`
- `cp db.example.sqlite3 db.sqlite3`
- `$EDITOR config.json` et remplir les champs
- `yarn start`

Si vous voulez faire un service Systemd, libre à vous.

## Liste des lignes
Pour mettre à jour la liste des lignes, un script `getLinesToDB` est fourni. Il est à lancer manuellement de temps en temps.

## Configuration
Le fichier de configuration est un fichier JSON plutôt simple, il est situé dans le même dossier que le script `index.js`.

Je doute que grand monde n'ait besoin de tout ce programme, mais tant qu'à le publier.