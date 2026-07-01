<template>
  <el-form label-width="160px" label-position="left" class="param-form">
    <el-form-item v-for="(meta, key) in fields" :key="key" :label="labelOf(key, meta)">
      <template v-if="typeOf(meta) === 'bool'">
        <el-switch v-model="model[key]" />
      </template>
      <template v-else-if="typeOf(meta) === 'string'">
        <el-input v-model="model[key]" />
      </template>
      <template v-else>
        <el-input-number
          v-model="model[key]"
          :min="rangeMin(meta)"
          :max="rangeMax(meta)"
          :step="typeOf(meta) === 'double' ? 0.1 : 1"
          :precision="typeOf(meta) === 'double' ? 3 : 0"
          controls-position="right"
        />
      </template>
      <span v-if="meta.desc_zh" class="field-desc">{{ meta.desc_zh }}</span>
    </el-form-item>

    <el-form-item>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      <el-button @click="reset">重置</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { reactive, watch, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { postConfig } from '@/api/http'

const props = defineProps<{ section: string; fields: Record<string, any> }>()
const emit = defineEmits<{ (e: 'saved'): void }>()

const model = reactive<Record<string, any>>({})
const saving = ref(false)

function typeOf(meta: any): string {
  return (meta && meta.type) || 'string'
}
function labelOf(key: string | number, meta: any): string {
  return meta && meta.name_zh ? meta.name_zh : String(key)
}
function rangeMin(meta: any): number | undefined {
  return meta && Array.isArray(meta.ranges) && meta.ranges.length >= 1 ? meta.ranges[0] : undefined
}
function rangeMax(meta: any): number | undefined {
  return meta && Array.isArray(meta.ranges) && meta.ranges.length >= 2 ? meta.ranges[1] : undefined
}

function initModel() {
  Object.keys(model).forEach((k) => delete model[k])
  for (const key of Object.keys(props.fields)) {
    const meta = props.fields[key]
    let def = meta ? meta.default : undefined
    if (typeOf(meta) === 'bool') def = !!def
    model[key] = def
  }
}

watch(() => props.fields, initModel, { immediate: true, deep: false })

async function save() {
  saving.value = true
  try {
    const payload: Record<string, any> = {}
    for (const key of Object.keys(model)) {
      payload[key] = model[key]
    }
    const res = await postConfig({ [props.section]: payload })
    if (res && res.succeed) {
      ElMessage.success('保存成功')
      emit('saved')
    } else {
      ElMessage.error('保存失败：' + (res && res.error ? res.error : '未知错误'))
    }
  } catch (e: any) {
    ElMessage.error('请求失败：' + (e && e.message ? e.message : e))
  } finally {
    saving.value = false
  }
}

function reset() {
  initModel()
}
</script>

<style scoped>
.param-form {
  max-width: 640px;
}
.field-desc {
  margin-left: 12px;
  color: #9ca3af;
  font-size: 12px;
}
</style>
