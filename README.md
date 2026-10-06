# Système de mises à jour sécurisé

Système de mise à jour sécurisé composé de trois composants côté serveur Debian — une API HTTPS, un site web de téléchargement et un dépôt de paquets — ainsi que d'un client Python pour Windows.

**Version du guide : v2**

## Vue d'ensemble

### Architecture

Le système repose sur :

- **Serveur API sécurisé** : HTTPS sur le port `8443`
- **Site web de téléchargement** : HTTP sur le port `3000`
- **Dépôt de paquets** : versions des mises à jour disponibles sur le serveur
- **Client Windows** : Python 3.10+ avec configuration pré-remplie

La sécurité repose notamment sur :

- TLS 1.3
- Certificat SSL
- Clés RSA 4096
- Signatures RSA avec SHA-256
- Vérification d'intégrité SHA-256
- Tokens d'authentification

### Flux utilisateur

1. Le client Windows ouvre `http://IP:3000`.
2. Il clique sur **Télécharger** et récupère `update-client.zip`.
3. Il décompresse le ZIP ; `config.ini` est déjà pré-rempli.
4. Il installe Python et les dépendances.
5. Il lance `python client.py`.
6. Le client contacte l'API en HTTPS sur `8443`.
7. Le manifeste est vérifié par signature RSA.
8. Le paquet est téléchargé, vérifié par SHA-256 puis installé.

## Prérequis

### Serveur Debian

- Debian Linux
- Node.js 20
- npm
- OpenSSL
- `zip`
- `curl`
- Accès SSH au serveur
- Ports `3000` et `8443` accessibles depuis les clients

### Client Windows

- Windows
- Python `3.10+`
- Navigateur web
- Accès réseau au serveur Debian

---

# Installation du serveur Debian

## 1. Installer Node.js et les outils

Mettre à jour le système :

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

Installer Node.js 20 :

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs openssl zip curl
```

Vérifier les versions :

```bash
node --version
npm --version
```

Le guide indique notamment :

```text
Node.js : v20.x.x
npm     : 10.x.x
```

## 2. Déployer les fichiers

Transférer `serveur-debian.zip` sur le serveur Debian.

Depuis Windows PowerShell :

```powershell
scp serveur-debian.zip USER@192.168.1.XXX:/home/USER/
```

Sur Debian :

```bash
unzip serveur-debian.zip -d ~/update-system
cd ~/update-system/server
npm install
```

## 3. Générer le certificat SSL

Depuis le répertoire du serveur :

```bash
cd ~/update-system/server
chmod +x setup-certs.sh
bash setup-certs.sh
```

Le script détecte l'IP locale et génère un certificat valable 10 ans.

Fichiers générés :

```text
certs/server.key    # NE PAS PARTAGER
certs/server.crt    # distribué automatiquement via le site
```

Notez l'IP affichée par le script. Elle correspond à l'adresse que les clients utiliseront pour accéder au site de téléchargement :

```text
http://192.168.1.42:3000
```

> Remplacez `192.168.1.42` par l'adresse réellement affichée sur votre serveur.

## 4. Générer les clés RSA et les tokens

Exécuter :

```bash
node setup-keys.js
```

Le script génère :

```text
keys/private.pem   # NE PAS PARTAGER
keys/public.pem   # distribuée via le site
```

Le script génère également les tokens d'administration et de client.

Le token client est automatiquement intégré dans le `config.ini` du ZIP généré par le site. Le client Windows n'a donc rien à configurer manuellement.

> **Sécurité :** ne partagez jamais `keys/private.pem`, le token administrateur ou les autres secrets générés.

## 5. Créer les paquets de test

```bash
chmod +x create-test-packages.sh
bash create-test-packages.sh
```

Le script crée les versions de test :

```text
1.0.0
1.0.1
1.0.2
```

La version `1.0.2` est proposée comme mise à jour dans le scénario du guide.

## 6. Démarrer les serveurs

Un seul script permet de démarrer simultanément l'API et le site :

```bash
chmod +x start-all.sh
bash start-all.sh
```

Le script vérifie notamment :

- les prérequis ;
- les clés RSA ;
- le certificat SSL ;
- l'IP locale.

Une sortie typique ressemble à :

```text
Vérification des prérequis...
Clés RSA : OK
Certificat SSL : OK
IP locale : 192.168.1.42
API mises à jour : https://192.168.1.42:8443
Site téléchargement: http://192.168.1.42:3000
Dites à vos clients de visiter http://192.168.1.42:3000
Ctrl+C pour tout arrêter
```

### Démarrage séparé

Il est également possible de démarrer les deux serveurs séparément :

```bash
node server.js
```

et :

```bash
node download-site.js
```

## 7. Démarrage automatique avec systemd

Modifier d'abord les deux fichiers service afin de remplacer `votre_utilisateur` par le nom d'utilisateur Debian approprié :

```bash
nano server/update-api.service
nano server/update-site.service
```

Copier les services :

```bash
sudo cp server/update-api.service /etc/systemd/system/
sudo cp server/update-site.service /etc/systemd/system/
```

Recharger systemd :

```bash
sudo systemctl daemon-reload
```

Activer les services au démarrage :

```bash
sudo systemctl enable update-api update-site
```

Les démarrer :

```bash
sudo systemctl start update-api update-site
```

Vérifier leur état :

```bash
sudo systemctl status update-api update-site
```

### Pare-feu

Si un pare-feu est actif, autoriser les deux ports :

```bash
sudo ufw allow 8443/tcp
sudo ufw allow 3000/tcp
sudo ufw reload
```

---

# Site web de téléchargement

Le site fonctionne sur le port HTTP `3000`.

## Fonctionnement

Le site génère le ZIP client à la volée à chaque téléchargement.

Il y insère automatiquement :

- l'IP du serveur détectée automatiquement ;
- le token client provenant de `tokens.json` ;
- le certificat SSL `server.crt` ;
- la clé publique RSA `public.pem` ;
- un `config.ini` entièrement pré-rempli ;
- `client.py` ;
- `scheduler.py` ;
- `requirements.txt` ;
- `LIRE-MOI.txt`.

Le client reçoit donc tout ce dont il a besoin dans un seul ZIP et n'a pas de configuration manuelle à effectuer.

## Contenu du ZIP généré

```text
update-client/
├── client.py
├── scheduler.py
├── requirements.txt
├── config.ini
├── server.crt
├── public.pem
└── LIRE-MOI.txt
```

### Rôle des fichiers

| Fichier | Rôle |
|---|---|
| `client.py` | Agent principal de mise à jour |
| `scheduler.py` | Vérification automatique |
| `requirements.txt` | Dépendances Python |
| `config.ini` | URL, token et chemins pré-remplis |
| `server.crt` | Certificat SSL du serveur |
| `public.pem` | Clé publique RSA |
| `LIRE-MOI.txt` | Instructions en français |

## Exemple de `config.ini`

Le fichier généré ressemble à :

```ini
[server]
url = https://192.168.1.42:8443
token = f6e5d4c3b2a1...
server_cert = server.crt

[security]
public_key_path = public.pem
```

L'URL, le token et les chemins sont automatiquement renseignés par le serveur.

## Accéder au site

Depuis un navigateur Windows connecté au même réseau :

```text
http://192.168.1.42:3000
```

La page affiche :

- la dernière version disponible ;
- le statut du serveur ;
- un bouton **Télécharger le client** ;
- les étapes d'installation.

Si certains éléments sont manquants, le site affiche un avertissement.

Exemples :

```text
Certificat SSL manquant -- lancez bash setup-certs.sh
Clé publique manquante -- lancez node setup-keys.js
```

Le bouton de téléchargement est automatiquement désactivé si le serveur n'est pas complètement configuré.

---

# Installation du client Windows

## 1. Télécharger le client

Depuis Windows, ouvrir :

```text
http://192.168.1.42:3000
```

> Remplacez l'adresse par l'IP affichée par `start-all.sh`.

Cliquer sur **Télécharger le client**.

Enregistrer :

```text
update-client.zip
```

Puis décompresser le fichier, par exemple dans :

```text
C:\update-client\
```

Le ZIP contient déjà :

- `config.ini`
- `server.crt`
- `public.pem`

Aucune modification manuelle de configuration n'est nécessaire.

## 2. Installer Python

Si Python n'est pas déjà installé :

1. Télécharger Python depuis le site officiel de Python.
2. Lors de l'installation, activer **Add Python to PATH**.
3. Vérifier l'installation dans PowerShell :

```powershell
python --version
```

Le guide utilise Python `3.11.x` comme exemple.

## 3. Installer les dépendances

Dans PowerShell :

```powershell
cd C:\update-client
pip install -r requirements.txt
```

Les dépendances utilisées dans l'exemple du guide incluent notamment :

```text
requests
cryptography
```

Cette installation n'est nécessaire qu'une seule fois.

## 4. Lancer la mise à jour

```powershell
cd C:\update-client
python client.py
```

Le client :

1. démarre ;
2. vérifie la connectivité au serveur ;
3. récupère le manifeste ;
4. vérifie sa signature ;
5. compare les versions ;
6. télécharge la mise à jour ;
7. vérifie son hash SHA-256 ;
8. crée une sauvegarde ;
9. installe la nouvelle version.

Exemple de résultat :

```text
Agent de mise à jour démarré
Vérification de la connectivité serveur...
Serveur joignable
Manifeste reçu : version 1.0.2
Signature du manifeste valide
Version actuelle : 0.0.0
Version disponible : 1.0.2
Téléchargement de update-1.0.2.zip...
Progression : 100.0%
Intégrité vérifiée (SHA-256 OK)
Sauvegarde créée
Version 1.0.2 installée
Mise à jour vers 1.0.2 terminée avec succès !
```

---

# Vérification automatique des mises à jour

Le script `scheduler.py` permet de vérifier automatiquement les nouvelles versions.

Lancer :

```powershell
python scheduler.py
```

Le guide utilise un intervalle de :

```text
3600 secondes
60 minutes
```

Exemple :

```text
Scheduler de mises à jour démarré
Intervalle : 3600 secondes (60 min)
Ctrl+C pour arrêter
```

Pour lancer automatiquement le scheduler au démarrage de Windows :

**Planificateur de tâches → Nouvelle tâche → `python C:\update-client\scheduler.py` au démarrage de session**

---

# Tests de sécurité

Le guide définit 7 scénarios permettant de valider les mécanismes de sécurité.

## Test 1 — Téléchargement depuis le site

### Action

Depuis Windows, ouvrir :

```text
http://IP:3000
```

Puis cliquer sur **Télécharger**.

### Résultat attendu

Le ZIP contient :

- `config.ini`
- `server.crt`
- `public.pem`

Le fichier `config.ini` doit contenir l'IP et le token corrects.

## Test 2 — Mise à jour normale

### Condition

Le client est en version `0.0.0` et le serveur propose `1.0.2`.

### Action

```powershell
python client.py
```

### Résultat attendu

La mise à jour est téléchargée et installée, et `state.json` est mis à jour.

## Test 3 — Client déjà à jour

### Action

Relancer :

```powershell
python client.py
```

après le test précédent.

### Résultat attendu

```text
Déjà à jour.
```

Aucune action supplémentaire ne doit être effectuée.

## Test 4 — Serveur inaccessible

### Condition

Arrêter le serveur Debian avec :

```text
Ctrl+C
```

### Résultat attendu

Le client indique que le serveur est inaccessible et s'arrête sans modifier les données locales.

## Test 5 — Token invalide

### Condition

Modifier le token dans `config.ini` avec une valeur incorrecte.

### Résultat attendu

```text
HTTP 403 — Token invalide
```

Aucun fichier ne doit être téléchargé.

## Test 6 — Signature corrompue

### Condition

Sur Debian, modifier le champ `signature` dans :

```text
packages/1.0.2/meta.json
```

### Résultat attendu

```text
ALERTE : Signature invalide ! Abandon.
```

Aucune installation ne doit avoir lieu.

## Test 7 — Hash corrompu

### Condition

Dans `meta.json`, remplacer la valeur `sha256` par une valeur incorrecte, par exemple :

```text
000000...
```

### Résultat attendu

```text
ALERTE : Hash invalide !
```

Le fichier temporaire doit être supprimé.

---

# Référence des fichiers

## Serveur Debian

| Fichier | Rôle |
|---|---|
| `server/server.js` | Serveur API principal — HTTPS `8443` |
| `server/download-site.js` | Site web de téléchargement — HTTP `3000` |
| `server/start-all.sh` | Lance les deux serveurs |
| `server/setup-keys.js` | Génère les clés RSA et tokens |
| `server/setup-certs.sh` | Génère le certificat SSL |
| `server/create-package.js` | Ajoute un nouveau paquet de mise à jour |
| `server/update-api.service` | Service systemd de l'API |
| `server/update-site.service` | Service systemd du site |
| `server/tokens.json` | Tokens d'authentification générés |
| `server/audit.log` | Journal des actions |
| `keys/private.pem` | Clé privée RSA — **NE PAS PARTAGER** |
| `keys/public.pem` | Clé publique RSA distribuée via le ZIP |
| `certs/server.crt` | Certificat SSL distribué via le ZIP |
| `certs/server.key` | Clé SSL — **NE PAS PARTAGER** |
| `packages/X.Y.Z/` | Dossier d'une version contenant `meta.json` et le fichier de mise à jour |

## Client Windows

| Fichier | Rôle |
|---|---|
| `client.py` | Agent principal de mise à jour |
| `scheduler.py` | Vérification automatique toutes les heures |
| `config.ini` | Configuration pré-remplie |
| `requirements.txt` | Dépendances Python |
| `server.crt` | Certificat SSL du serveur |
| `public.pem` | Clé publique RSA |
| `LIRE-MOI.txt` | Instructions en français |
| `state.json` | Version installée et historique |
| `client.log` | Journal des opérations |
| `backups/` | Sauvegardes avant chaque mise à jour |
| `app/` | Dossier d'installation de l'application |

---

# Dépannage

## Le site web n'est pas accessible

Adresse :

```text
http://IP:3000
```

Vérifier que le serveur web fonctionne :

```bash
ps aux | grep node
```

Vérifier le port :

```bash
sudo ss -tlnp | grep 3000
```

Si nécessaire, ouvrir le port :

```bash
sudo ufw allow 3000/tcp
```

Tester depuis Debian :

```bash
curl http://localhost:3000
```

## Le bouton « Télécharger » est grisé

Exécuter les étapes de configuration nécessaires :

```bash
node setup-keys.js
```

puis :

```bash
bash setup-certs.sh
```

Actualiser ensuite la page web.

## Le ZIP téléchargé est corrompu

Vérifier les logs du site :

```bash
tail -f logs/site.log
```

Vérifier que `client.py` existe dans le dossier `client/`.

Vérifier également les droits :

```bash
ls -la keys/ certs/
```

Les fichiers doivent être lisibles par le processus du serveur.

## Erreur SSL côté client

Vérifier que `server.crt` se trouve dans le même dossier que `client.py`.

Dans `config.ini`, vérifier :

```ini
server_cert = server.crt
```

Pour le mode test indiqué par le guide, il est possible de désactiver la vérification SSL avec :

```ini
server_cert = false
```

## Erreur HTTP 401/403 après extraction

Le token présent dans `config.ini` peut être incorrect.

Le guide recommande :

1. supprimer le ZIP ;
2. relancer `start-all.sh` ;
3. télécharger à nouveau le client ;
4. vérifier `tokens.json` sur le serveur.

## `ModuleNotFoundError` avec `python client.py`

Installer les dépendances :

```powershell
pip install -r requirements.txt
```

Vérifier la version de Python :

```powershell
python --version
```

Python `3.10+` est requis.

Si plusieurs installations Python sont présentes :

```powershell
py -3 -m pip install -r requirements.txt
```

---

# Commandes de diagnostic

## Vérifier les deux serveurs

```bash
ps aux | grep node
```

## Afficher les logs API en temps réel

```bash
tail -f ~/update-system/logs/api.log
```

## Afficher les logs du site en temps réel

```bash
tail -f ~/update-system/logs/site.log
```

## Tester le site depuis Debian

```bash
curl http://localhost:3000
```

## Tester l'API depuis Debian

```bash
curl -k https://localhost:8443/health
```

## Tester la connexion depuis Windows

Dans PowerShell :

```powershell
Test-NetConnection -ComputerName 192.168.1.42 -Port 3000
Test-NetConnection -ComputerName 192.168.1.42 -Port 8443
```

> Remplacez `192.168.1.42` par l'IP réelle du serveur.

## Consulter les logs du client Windows

```powershell
type C:\update-client\client.log
```

---

# Ports utilisés

| Service | Protocole | Port | Usage |
|---|---|---:|---|
| Site de téléchargement | HTTP | `3000` | Téléchargement du ZIP client |
| API de mise à jour | HTTPS | `8443` | Vérification et téléchargement des mises à jour |

---

# Sécurité

Les fichiers suivants contiennent des informations sensibles et ne doivent pas être partagés :

```text
keys/private.pem
certs/server.key
server/tokens.json
```

À l'inverse, les éléments suivants sont destinés à être distribués au client :

```text
keys/public.pem
certs/server.crt
```

Le client vérifie :

1. l'authentification par token ;
2. la signature RSA du manifeste ;
3. l'intégrité du paquet avec SHA-256 ;
4. puis installe la mise à jour après vérification.

---

# Résumé du déploiement

## Serveur Debian

```bash
sudo apt-get update && sudo apt-get upgrade -y

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs openssl zip curl

unzip serveur-debian.zip -d ~/update-system
cd ~/update-system/server
npm install

chmod +x setup-certs.sh
bash setup-certs.sh

node setup-keys.js

chmod +x create-test-packages.sh
bash create-test-packages.sh

chmod +x start-all.sh
bash start-all.sh
```

## Client Windows

Depuis le navigateur :

```text
http://IP_DU_SERVEUR:3000
```

Télécharger puis extraire `update-client.zip`.

Ensuite :

```powershell
cd C:\update-client
pip install -r requirements.txt
python client.py
```

Pour la vérification automatique :

```powershell
python scheduler.py
```

---

# Dépannage rapide

| Problème | Première vérification |
|---|---|
| Site inaccessible | `ps aux \| grep node` et port `3000` |
| Téléchargement désactivé | `setup-keys.js` + `setup-certs.sh` |
| Erreur SSL | Présence de `server.crt` et valeur `server_cert` |
| HTTP 401/403 | Vérifier le token et régénérer le ZIP |
| `ModuleNotFoundError` | `pip install -r requirements.txt` |
| Serveur inaccessible | Vérifier les ports `3000` et `8443` |
| Signature invalide | Vérifier `meta.json` et la clé publique |
| Hash invalide | Vérifier le champ `sha256` dans `meta.json` |

---

## Référence

Ce README est basé sur le document **« Système de mises à jour sécurisé — Guide d'installation complet v2 »**, qui décrit l'architecture, l'installation Debian, le site de téléchargement, le client Windows, les scénarios de sécurité, la référence des fichiers et le dépannage.
