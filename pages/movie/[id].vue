<script setup lang="ts">
const route = useRoute()
const tmdbId = computed(() => Number(route.params.id))
</script>

<template>
  <DetailView type="movie" :tmdb-id="tmdbId" />
</template>
