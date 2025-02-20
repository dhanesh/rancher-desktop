<script lang="ts">
import { shell } from 'electron';
import Vue from 'vue';
import { mapState } from 'vuex';

export default Vue.extend({
  name:       'help',
  props:      {
    fixedUrl: {
      type:     String,
      default:  null,
    },
    tooltip: {
      type:    String,
      default: null,
    },
  },
  computed: {
    ...mapState('help', ['url']),
    helpUrl(): string {
      return this.fixedUrl ?? this.url;
    },
    tooltipContent(): string | null {
      return this.helpUrl ? this.tooltip : null;
    },
  },
  methods:  {
    openUrl() {
      if (this.helpUrl) {
        shell.openExternal(this.helpUrl);
      }
    },
  },
});
</script>

<template>
  <div class="help-button">
    <button
      v-tooltip="{
        content: tooltipContent,
        placement: 'right'
      }"
      class="btn role-fab ripple"
      :class="{
        disabled: !helpUrl
      }"
      @click="openUrl"
    >
      <span
        class="icon icon-question-mark"
        :class="{
          disabled: !helpUrl
        }"
      />
    </button>
  </div>
</template>

<style lang="scss" scoped>

  .help-button {

    .icon {
      display: inline-block;
      color: var(--primary);
      font-size: 1.5rem;
      width: 1.5rem;
      height: 1.5rem;
      cursor: pointer;
    }

    .disabled {
      background: transparent !important;
      color: var(--body-text);
      opacity: 0.2;
      cursor: default;
    }

    // We make use of the term Floating Action Button (fab) here because the
    // design of this button is reminiscent of floating actions buttons from
    // Material Design
    .role-fab {
      all: revert;
      line-height: 0;
      border: 0;
      padding: 0.1rem;
      background: none;
      color: var(--body-text);
      transition: background 200ms;
      border-radius: 50%;
    }

    .ripple {
      background-position: center;
      transition: background 0.4s;

      &:hover {
        background: var(--tooltip-bg) radial-gradient(circle, transparent 1%, var(--tooltip-bg) 1%) center/15000%;
      }

      &:active {
        background-color: var(--default);
        background-size: 100%;
        transition: background 0s;
      }

    }
  }
</style>
