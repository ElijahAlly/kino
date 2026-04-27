export interface LibraryItem {
  tmdbId: number
  imdbId: string
  title: string
  posterPath: string | null
  type: 'movie' | 'tv'
  addedAt: number
}

export function useLibrary() {
  const library = useState<LibraryItem[]>('library', () => {
    try {
      return JSON.parse(localStorage.getItem('kino-library') || '[]')
    } catch {
      return []
    }
  })

  function persist() {
    localStorage.setItem('kino-library', JSON.stringify(library.value))
  }

  function saveToLibrary(item: LibraryItem) {
    if (library.value.some(i => i.tmdbId === item.tmdbId)) return
    library.value.unshift(item)
    persist()
  }

  function removeFromLibrary(tmdbId: number) {
    library.value = library.value.filter(i => i.tmdbId !== tmdbId)
    persist()
  }

  function isInLibrary(tmdbId: number) {
    return library.value.some(i => i.tmdbId === tmdbId)
  }

  return { library, saveToLibrary, removeFromLibrary, isInLibrary }
}
