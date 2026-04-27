#!/bin/bash
# Usage:
#   Movies:  ./watch.sh tt1856101
#            ./watch.sh https://www.imdb.com/title/tt1856101/
#   Series:  ./watch.sh tt0903747:1:1              (Breaking Bad S01E01)
#            ./watch.sh tt0903747 1 1              (alternate format)
#   Multiple: ./watch.sh tt1856101 tt0468569
#   Mixed:    ./watch.sh tt1856101 tt0903747:1:1

TOKEN="RQNWBK57IBVYN5JPS5IV3H3G422GMJ2VTE67JSL3D3F5UEYOF2GA"
TORRENTIO_BASE="https://torrentio.strem.fun/qualityfilter=unknown,threed,cam,scr,brremux,hdrall,other,480p,4k|realdebrid=$TOKEN"
OUTPUT_FILE="watch_urls.txt"

process_id() {
  local raw="$1"
  local imdb_id endpoint query_id

  imdb_id=$(echo "$raw" | grep -oE 'tt[0-9]+' | head -1)
  [ -z "$imdb_id" ] && { echo "❌ Invalid: $raw"; return; }

  if [[ "$raw" == *":"* ]]; then
    season_ep=$(echo "$raw" | grep -oE ':[0-9]+:[0-9]+')
    query_id="${imdb_id}${season_ep}"
    endpoint="series"
  else
    query_id="$imdb_id"
    endpoint="movie"
  fi

  echo "🔍 Looking up $query_id ($endpoint)..."

  streams=$(curl -s "$TORRENTIO_BASE/stream/$endpoint/$query_id.json")
  
  # Try each stream until one resolves successfully
  echo "$streams" | tr -d '\n' | sed 's/},{/}\n{/g' | head -5 | while read line; do
    torrentio_url=$(echo "$line" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
    title=$(echo "$line" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p' | head -c 60)
    
    [ -z "$torrentio_url" ] && continue
    
    echo "  Trying: $title"
    
    # Follow redirects to get the actual RD URL
    final_url=$(curl -sL -o /dev/null -w "%{url_effective}" --max-time 30 "$torrentio_url")
    
    # Check if it resolved to a real-debrid URL (not still on torrentio)
    if [[ "$final_url" == *"real-debrid.com"* ]]; then
      echo "  ✅ Resolved!"
      echo "$query_id	$title	$final_url" >> "$OUTPUT_FILE"
      echo "🔗 $final_url"
      return 0
    else
      echo "  ❌ Failed (uncached or not ready)"
    fi
  done
  
  echo "❌ No working stream found for $query_id"
}

> "$OUTPUT_FILE"

# Handle multi-arg series format
args=()
i=1
while [ $i -le $# ]; do
  current="${!i}"
  next_idx=$((i+1))
  next_next_idx=$((i+2))
  if [[ "$current" =~ ^tt[0-9]+$ ]] && [ $next_idx -le $# ] && [ $next_next_idx -le $# ]; then
    next="${!next_idx}"
    next_next="${!next_next_idx}"
    if [[ "$next" =~ ^[0-9]+$ ]] && [[ "$next_next" =~ ^[0-9]+$ ]]; then
      args+=("${current}:${next}:${next_next}")
      i=$((i+3)); continue
    fi
  fi
  args+=("$current")
  i=$((i+1))
done

for arg in "${args[@]}"; do
  process_id "$arg"
  echo ""
done

echo "✅ Done. URLs in $OUTPUT_FILE"
echo ""
cat "$OUTPUT_FILE"
