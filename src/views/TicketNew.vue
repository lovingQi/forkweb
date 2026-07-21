<template>
  <div class="ticket-new-page">
    <el-card shadow="never">
      <template #header>
        <div class="new-header">新建工单</div>
      </template>
      <el-form :model="form" label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="一句话概括问题" />
        </el-form-item>
        <el-form-item label="问题描述">
          <el-input v-model="form.description" type="textarea" :rows="4" placeholder="请简要描述当前遇到的问题" />
        </el-form-item>
        <el-form-item label="日志压缩包">
          <el-upload
            ref="logUpload"
            accept=".zip,.tar.gz,.tgz"
            :auto-upload="false"
            :limit="1"
            :on-change="onLogChange"
          >
            <el-button type="primary">选择日志压缩包</el-button>
            <template #tip>
              <div class="el-upload__tip">支持 zip / tar.gz，最大 500MB</div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="地图文件">
          <el-upload
            ref="mapUpload"
            accept=".json"
            :auto-upload="false"
            :limit="1"
            :on-change="onMapChange"
          >
            <el-button>选择地图文件</el-button>
            <template #tip>
              <div class="el-upload__tip">可选，json 格式</div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="AI 介入分析">
          <el-switch v-model="form.aiEnabled" active-text="开启" inactive-text="关闭" />
          <div class="ai-tip">开启后会调用大模型基于日志上下文和问题描述生成 AI 分析结论，耗时可能较长</div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="onSubmit">提交工单</el-button>
          <el-button @click="router.back()">取消</el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTicketStore } from '@/stores/tickets'
import type { UploadFile } from 'element-plus'

const router = useRouter()
const ticketStore = useTicketStore()
const submitting = ref(false)
const error = ref('')

const form = reactive({
  title: '',
  description: '',
  logs: null as File | null,
  map: null as File | null,
  aiEnabled: false
})

function onLogChange(file: UploadFile) {
  form.logs = file.raw || null
}

function onMapChange(file: UploadFile) {
  form.map = file.raw || null
}

async function onSubmit() {
  error.value = ''
  if (!form.title.trim() || !form.description.trim()) {
    error.value = '标题和描述不能为空'
    return
  }
  if (!form.logs) {
    error.value = '请上传日志压缩包'
    return
  }
  submitting.value = true
  try {
    const ticket = await ticketStore.createTicket({
      title: form.title.trim(),
      description: form.description.trim(),
      logs: form.logs,
      map: form.map || undefined,
      aiEnabled: form.aiEnabled
    })
    router.push(`/tickets/${ticket.id}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.new-header {
  font-size: 16px;
  font-weight: 600;
}
.ai-tip {
  margin-left: 12px;
  font-size: 12px;
  color: #6b7280;
}
</style>
