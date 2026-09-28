# Relie les mails cités par numéro dans le texte « source » des actions (« #300 », « #422-#456 ») à des sources
# « mail » (date, expéditeur, objet, identifiant) lues dans <projet>\data\index-mails.csv.
# Les objets et expéditeurs restent en base et dans OneDrive, jamais dans le dépôt.
# Relançable sans risque : un mail déjà relié à une action est ignoré.
# Usage : .\scripts\relier-sources-mails.ps1 [-Simulation]
param([string]$Racine = "$env:USERPROFILE\OneDrive - EPCI DE CORSE\Projets européens", [switch]$Simulation)

$ErrorActionPreference = "Stop"
$sql = Join-Path $PSScriptRoot "sql.ps1"
$actions = & $sql -ReadOnly -Query @"
select a.id, a.source, p.acronyme, p.dossier from gestion_projets.actions a join gestion_projets.projets p on p.id = a.projet_id
where a.source ~ '#[0-9]' and p.dossier is not null
"@ | ConvertFrom-Json

# Index des mails d'un projet, par numéro. Séparateur « ; » ou « , » selon le projet ; colonne expéditeur au nom variable.
$index = @{}
function Index-Projet([string]$dossier) {
  if ($index.ContainsKey($dossier)) { return $index[$dossier] }
  $f = Join-Path $Racine "$dossier\data\index-mails.csv"
  $t = @{}
  if (Test-Path -LiteralPath $f) {
    $entete = (Get-Content -LiteralPath $f -Encoding UTF8 -TotalCount 1)
    $sep = if ($entete.Split(';').Count -gt $entete.Split(',').Count) { ';' } else { ',' }
    $lignes = Import-Csv -LiteralPath $f -Delimiter $sep -Encoding UTF8
    $colExp = ($lignes[0].PSObject.Properties.Name | Where-Object { $_ -like 'expediteur*' } | Select-Object -First 1)
    foreach ($l in $lignes) {
      if ($l.n -match '^\d+$') { $t[[int]$l.n] = @{ date = $l.date; expediteur = $l.$colExp; objet = $l.objet; unid = $l.unid } }
    }
  } else { Write-Warning "Index absent : $f" }
  $index[$dossier] = $t
  $t
}

function Q([string]$v) { if ([string]::IsNullOrWhiteSpace($v)) { 'null' } else { "'" + $v.Trim().Replace("'", "''") + "'" } }

$valeurs = New-Object System.Collections.Generic.List[string]
$introuvables = New-Object System.Collections.Generic.List[string]
foreach ($a in $actions) {
  $t = Index-Projet $a.dossier
  $numeros = New-Object System.Collections.Generic.List[int]
  foreach ($m in [regex]::Matches($a.source, '#(\d+)(?:\s*-\s*#?(\d+))?')) {
    $de = [int]$m.Groups[1].Value
    $a_ = if ($m.Groups[2].Success) { [int]$m.Groups[2].Value } else { $de }
    # Plage longue (« #422-#456 ») : seuls ses deux bouts, pour ne pas noyer l'action sous les mails.
    $liste = if ($a_ - $de -le 10) { $de..$a_ } else { @($de, $a_) }
    foreach ($n in $liste) { if (-not $numeros.Contains($n)) { $numeros.Add($n) } }
  }
  foreach ($n in $numeros) {
    $mail = $t[$n]
    if (-not $mail) { $introuvables.Add("$($a.acronyme) #$n"); continue }
    $ref = if ($mail.unid) { "VERSE-$($mail.unid)" } else { "INDEX-$($a.dossier)-$n" }
    $valeurs.Add("('$($a.id)', 'mail', $(Q $mail.date), $(Q $mail.expediteur), $(Q $mail.objet), $(Q $ref), $n, 'systeme')")
  }
}

"$($actions.Count) actions citent des mails ; $($valeurs.Count) mails retrouvés dans les index ; $($introuvables.Count) introuvables."
if ($introuvables.Count) { "Introuvables : " + ($introuvables -join ', ') }
if ($Simulation -or -not $valeurs.Count) { return }

$requete = @"
insert into gestion_projets.sources (action_id, type, date_source, expediteur, objet, mail_ref, numero, ajoute_par) values
$($valeurs -join ",`n")
on conflict (coalesce(action_id, echeance_id, livrable_id, periode_id, point_id, info_id), mail_ref) where mail_ref is not null do nothing
returning id
"@
$r = & $sql -Query $requete | ConvertFrom-Json
"$(@($r).Count) sources mail ajoutées."
