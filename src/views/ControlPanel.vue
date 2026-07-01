<template>
  <div class="control-panel">
    <el-row :gutter="16">
      <el-col :span="10">
        <el-card shadow="never" class="mb">
          <template #header>运行控制</template>
          <div class="btn-row">
            <el-button type="danger" @click="doControl('stop')">停止</el-button>
            <el-button @click="doControl('idle')">空闲</el-button>
            <el-button type="warning" @click="doControl('dock')">回充</el-button>
          </div>
          <div class="btn-row mt">
            <span class="lbl">电机</span>
            <el-button type="success" @click="setMotor(true)">使能</el-button>
            <el-button type="info" @click="setMotor(false)">断开</el-button>
            <el-tag :type="store.motor ? 'success' : 'danger'" size="small">{{ store.motor ? '已使能' : '已断开' }}</el-tag>
          </div>
          <div class="btn-row mt">
            <span class="lbl">安全模式</span>
            <el-switch v-model="safe" @change="onSafeChange" />
          </div>
        </el-card>

        <el-card shadow="never">
          <template #header>重定位</template>
          <el-form label-width="80px">
            <el-form-item label="方式">
              <el-radio-group v-model="locTarget">
                <el-radio label="goal">站点</el-radio>
                <el-radio label="pose">坐标</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="locTarget === 'goal'" label="站点">
              <el-input v-model="locGoal" placeholder="站点名称" />
            </el-form-item>
            <template v-else>
              <el-form-item label="X (mm)">
                <el-input-number v-model="poseX" :step="100" controls-position="right" />
              </el-form-item>
              <el-form-item label="Y (mm)">
                <el-input-number v-model="poseY" :step="100" controls-position="right" />
              </el-form-item>
              <el-form-item label="θ (°)">
                <el-input-number v-model="poseTh" :step="1" controls-position="right" />
              </el-form-item>
            </template>
            <el-form-item>
              <el-button type="primary" @click="doLocalize">重定位</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>点动控制</span>
              <span class="speed-box">
                速度
                <el-slider v-model="speed" :min="5" :max="100" :step="5" style="width: 180px" />
                {{ speed }}%
              </span>
            </div>
          </template>
          <el-alert
            type="info"
            :closable="false"
            title="按住方向键点动，松开即停止。请确保周围安全。"
            class="mb"
          />
          <div class="jog-pad">
            <div></div>
            <el-button class="jog-btn" @mousedown="jog(1, 0)" @mouseup="jogStop" @mouseleave="jogStop">前进</el-button>
            <div></div>
            <el-button class="jog-btn" @mousedown="jog(0, 1)" @mouseup="jogStop" @mouseleave="jogStop">左转</el-button>
            <el-button class="jog-btn stop" @click="jogStop">停</el-button>
            <el-button class="jog-btn" @mousedown="jog(0, -1)" @mouseup="jogStop" @mouseleave="jogStop">右转</el-button>
            <div></div>
            <el-button class="jog-btn" @mousedown="jog(-1, 0)" @mouseup="jogStop" @mouseleave="jogStop">后退</el-button>
            <div></div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRobotStore } from '@/stores/robot'
import { control } from '@/api/http'

const store = useRobotStore()

const speed = ref(20)
const safe = ref(store.safe)
watch(() => store.safe, (v) => (safe.value = v))

const locTarget = ref<'goal' | 'pose'>('goal')
const locGoal = ref('')
const poseX = ref(0)
const poseY = ref(0)
const poseTh = ref(0)

async function doControl(action: string, payload: Record<string, any> = {}) {
  try {
    const res = await control(action, payload)
    if (res && res.succeed) ElMessage.success('指令已下发')
    else ElMessage.error('失败：' + (res && res.error ? res.error : '未知错误'))
  } catch (e: any) {
    ElMessage.error('请求失败：' + (e && e.message ? e.message : e))
  }
}

function setMotor(flag: boolean) {
  doControl('motor', { flag })
}

function onSafeChange(val: boolean) {
  doControl('safe', { flag: val })
}

function jog(trans: number, rot: number) {
  control('drive', { trans, rot, speed: speed.value }).catch(() => {})
}

function jogStop() {
  control('stop').catch(() => {})
}

function doLocalize() {
  if (locTarget.value === 'goal') {
    if (!locGoal.value) {
      ElMessage.warning('请输入站点名称')
      return
    }
    doControl('localize', { target: 'goal', goal: locGoal.value })
  } else {
    doControl('localize', { target: 'pose', poseX: poseX.value, poseY: poseY.value, poseTh: poseTh.value })
  }
}
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.mt {
  margin-top: 14px;
}
.btn-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.lbl {
  color: #6b7280;
  width: 56px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.speed-box {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #6b7280;
}
.jog-pad {
  display: grid;
  grid-template-columns: repeat(3, 100px);
  grid-gap: 12px;
  justify-content: center;
  padding: 20px 0;
}
.jog-btn {
  height: 64px;
  font-size: 16px;
}
.jog-btn.stop {
  background: #ef4444;
  color: #fff;
  border-color: #ef4444;
}
</style>
