import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class UserService {
  UserService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  Future<DocumentSnapshot<Map<String, dynamic>>> getCurrentUserDoc() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw StateError('User not signed in');
    }
    return _firestore.collection('users').doc(uid).get();
  }

  Future<void> ensureUserDoc({
    required String role,
    required bool approved,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw StateError('User not signed in');
    }

    final userRef = _firestore.collection('users').doc(user.uid);
    final snap = await userRef.get();

    if (!snap.exists) {
      await userRef.set({
        'role': role,
        'approved': approved,
        'active': true,
        'phone': user.phoneNumber,
        'createdAt': FieldValue.serverTimestamp(),
      });
    }
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchUsers() {
    return _firestore.collection('users').snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchActiveDeliveryUsers() {
    return _firestore
        .collection('users')
        .where('role', isEqualTo: 'delivery')
        .where('approved', isEqualTo: true)
        .where('active', isEqualTo: true)
        .snapshots();
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchDeliveryAgents() {
    return _firestore
        .collection('delivery_agents')
        .orderBy('createdAt', descending: true)
        .snapshots();
  }

  Future<void> addDeliveryAgent({
    required String name,
    required String phone,
    required String area,
  }) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('User not signed in');

    final normalized = _normalizePhone(phone);
    await _firestore.collection('delivery_agents').doc(normalized).set({
      'name': name,
      'phone': normalized,
      'area': area,
      'active': true,
      'createdBy': user.uid,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  Future<void> setDeliveryAgentActive(String phone, bool active) async {
    final normalized = _normalizePhone(phone);
    await _firestore.collection('delivery_agents').doc(normalized).set({
      'active': active,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    final users = await _firestore
        .collection('users')
        .where('role', isEqualTo: 'delivery')
        .where('phone', isEqualTo: normalized)
        .get();
    final batch = _firestore.batch();
    for (final doc in users.docs) {
      batch.update(doc.reference, {
        'active': active,
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  Future<bool> canRoleLogin({
    required String role,
    required String phone,
  }) async {
    if (role == 'customer') return true;
    final normalized = _normalizePhone(phone);

    if (role == 'delivery') {
      final agent = await _firestore
          .collection('delivery_agents')
          .where('phone', isEqualTo: normalized)
          .where('active', isEqualTo: true)
          .limit(1)
          .get();
      return agent.docs.isNotEmpty;
    }

    if (role == 'owner') {
      final owner = await _firestore
          .collection('users')
          .where('role', isEqualTo: 'owner')
          .where('phone', isEqualTo: normalized)
          .where('approved', isEqualTo: true)
          .where('active', isEqualTo: true)
          .limit(1)
          .get();
      return owner.docs.isNotEmpty;
    }

    return false;
  }

  Future<void> syncRoleAccessAfterLogin(String role) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('User not signed in');
    final phone = _normalizePhone(user.phoneNumber ?? '');
    if (phone.isEmpty) throw StateError('Phone number missing');

    if (role == 'customer') {
      await ensureUserDoc(role: role, approved: true);
      return;
    }

    if (role == 'delivery') {
      final agentSnap = await _firestore
          .collection('delivery_agents')
          .where('phone', isEqualTo: phone)
          .where('active', isEqualTo: true)
          .limit(1)
          .get();
      if (agentSnap.docs.isEmpty) {
        throw StateError('Contact admin');
      }
      final agent = agentSnap.docs.first.data();
      await _firestore.collection('users').doc(user.uid).set({
        'role': 'delivery',
        'approved': true,
        'active': true,
        'phone': phone,
        'name': (agent['name'] ?? '').toString(),
        'assignedArea': (agent['area'] ?? '').toString(),
        'updatedAt': FieldValue.serverTimestamp(),
        'createdAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      return;
    }

    if (role == 'owner') {
      final ownerSnap = await _firestore
          .collection('users')
          .where('role', isEqualTo: 'owner')
          .where('phone', isEqualTo: phone)
          .where('approved', isEqualTo: true)
          .where('active', isEqualTo: true)
          .limit(1)
          .get();
      if (ownerSnap.docs.isEmpty) {
        throw StateError('Contact admin');
      }
      final existing = ownerSnap.docs.first.data();
      await _firestore.collection('users').doc(user.uid).set({
        'role': 'owner',
        'approved': true,
        'active': true,
        'phone': phone,
        if (existing['name'] != null) 'name': existing['name'],
        'updatedAt': FieldValue.serverTimestamp(),
        'createdAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
  }

  Future<void> setApproved(String uid, bool approved) {
    return _firestore.collection('users').doc(uid).update({
      'approved': approved,
    });
  }

  Future<void> setActive(String uid, bool active) {
    return _firestore.collection('users').doc(uid).update({
      'active': active,
    });
  }

  String _normalizePhone(String raw) {
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 10) return '+91$digits';
    if (digits.length == 12 && digits.startsWith('91')) return '+$digits';
    if (raw.startsWith('+')) return raw;
    return raw;
  }
}
