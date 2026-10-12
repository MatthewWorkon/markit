<script setup lang="ts">
import ToastHost from '@/components/ToastHost.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import ShareModal from '@/components/ShareModal.vue'
</script>

<template>
  <router-view />
  <ToastHost />
  <ConfirmDialog />
  <SettingsModal />
  <ShareModal />
</template>
